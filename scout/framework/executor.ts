/**
 * One LangGraph graph runs every agent. Each LLM turn, tool round, and human stop is its own
 * checkpointed step, so an execution can pause for a person, survive a restart, and resume
 * exactly where it was. The transcript is append-only and stored verbatim, so Claude's thinking
 * blocks replay unchanged on the next turn.
 *
 *   start → model ⇄ (gate → tools) … → stop (HITL) → finish → end
 *                ↘ nudge (ended without the output tool)
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import { getVersion } from "./agents";
import { logger } from "./events";
import type { Connection } from "./store";
import { recallFrom, writeMemory } from "./tools/memory";
import { inputSchema, tool, TOOLS } from "./tools/index";
import type { AgentDefinition, Decision, ModelMessage, OutputResult, ToolContext } from "./types";

const MAX_NUDGES = 2;
/** The same failing tool round this many times in a row means the agent can't fix it (e.g. a bad input). */
const MAX_REPEATED_ERRORS = 3;
const MAX_RESULT_CHARS = 30_000;

export type Hooks = {
  /** Start a child execution for a handoff. The id is deterministic, so a replayed finish doesn't double-spawn. */
  spawn: (agent: string, input: Record<string, unknown>, link: { id: string; parentId: string; itemId: string }) => Promise<void>;
  isCancelled: (executionId: string) => Promise<boolean>;
  echo?: boolean;
};

export const ExecState = Annotation.Root({
  executionId: Annotation<string>,
  versionId: Annotation<string>,
  input: Annotation<Record<string, unknown>>,
  messages: Annotation<ModelMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  step: Annotation<number>,
  turns: Annotation<number>,
  nudges: Annotation<number>,
  approvals: Annotation<string[] | null>,
  output: Annotation<unknown>,
  decision: Annotation<Decision | null>,
  stopError: Annotation<string | null>,
  result: Annotation<unknown>,
  errorStreak: Annotation<{ key: string; n: number } | null>,
  outcome: Annotation<string | null>,
  failed: Annotation<string | null>,
});

type State = typeof ExecState.State;

function system(def: AgentDefinition): string {
  return `You are the "${def.name}" agent in a local, human-supervised research framework. ${def.description}

Rules for every agent:
- Every fact you rely on comes from a tool result. When the sources don't settle something, say unknown or inferred; never guess to fill a field.
- Memory persists across runs. Memories recalled for this input are listed under it; use recall for more, and remember durable facts worth keeping, with their source.
- People read your work: your tool calls, your reasoning summaries, and what you submit appear in an audit log.
- Finish by calling ${def.output}. A person reviews it before anything changes.

---

${def.instructions}`;
}

function toolUses(messages: ModelMessage[]): Anthropic.ToolUseBlock[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || typeof last.content === "string") return [];
  return (last.content as Anthropic.ContentBlock[]).filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
}

/** "lead/{item.id}" with the input → "lead/buckeye-furnace"; null when a path is missing. */
function resolveNamespace(template: string, input: Record<string, unknown>): string | null {
  let missing = false;
  const out = template.replace(/\{([^}]+)\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), input);
    if (value === undefined || value === null || value === "") missing = true;
    return String(value ?? "");
  });
  return missing ? null : out;
}

function childId(parentId: string, itemId: string): string {
  const h = createHash("sha1").update(`${parentId}:${itemId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildExecutor(conn: Connection, hooks: Hooks) {
  const { db, store, client } = conn;
  const log = (s: State, step: number) => logger(db, s.executionId, step, hooks.echo);
  const definition = async (s: State) => (await getVersion(db, s.versionId)).definition;
  const ctxFor = (s: State, def: AgentDefinition, step: number, l: ReturnType<typeof log>): ToolContext => ({
    db,
    memory: store,
    executionId: s.executionId,
    agent: def.name,
    input: s.input,
    step,
    log: l.log,
  });

  async function start(s: State): Promise<Partial<State>> {
    const step = 1;
    const l = log(s, step);
    const version = await getVersion(db, s.versionId);
    l.log("start", { agent: version.name, version: version.version, input: s.input });
    const recalled: string[] = [];
    for (const template of version.definition.recall) {
      const ns = resolveNamespace(template, s.input);
      if (!ns) continue;
      const found = await recallFrom(store, ns, undefined, 20);
      l.log("memory_read", { namespace: ns, auto: true, keys: found.map((m) => `${m.namespace}:${m.key}`) });
      for (const m of found) {
        recalled.push(`- [${m.namespace}:${m.key}] ${m.text}${m.source ? ` (source: ${m.source})` : ""} (${m.agent}, ${m.at.slice(0, 10)})`);
      }
    }
    const text = [
      `Input:\n\`\`\`json\n${JSON.stringify(s.input, null, 2)}\n\`\`\``,
      recalled.length ? `Recalled memories:\n${recalled.join("\n")}` : "No memories recalled for this input.",
    ].join("\n\n");
    await l.flush();
    return {
      messages: [{ role: "user", content: text }],
      step,
      turns: 0,
      nudges: 0,
      approvals: null,
      output: null,
      decision: null,
      stopError: null,
      result: null,
      errorStreak: null,
      outcome: null,
      failed: null,
    };
  }

  async function model(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const l = log(s, step);
    const def = await definition(s);
    const fail = async (reason: string) => {
      l.log("error", { reason });
      await l.flush();
      return { step, failed: reason };
    };
    if (await hooks.isCancelled(s.executionId)) return fail("cancelled");
    if (s.turns >= def.maxTurns) return fail(`reached ${def.maxTurns} turns without finishing`);

    const tools = [...def.tools, def.output].map((name) => {
      const t = tool(name);
      return { name: t.name, description: t.description, input_schema: inputSchema(t) as Anthropic.Tool.InputSchema, eager_input_streaming: true };
    });
    const started = Date.now();
    let reply: Anthropic.Message;
    try {
      reply = await client.messages
        .stream({
          model: def.model,
          max_tokens: 32000,
          system: system(def),
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: def.effort },
          cache_control: { type: "ephemeral" },
          tools,
          messages: s.messages,
        })
        .finalMessage();
    } catch (err) {
      return fail(`model call failed: ${message(err)}`);
    }

    l.log("llm_call", { model: def.model, effort: def.effort, stopReason: reply.stop_reason, usage: reply.usage, ms: Date.now() - started });
    for (const block of reply.content) {
      if (block.type === "thinking" && block.thinking.trim()) l.log("thinking", { text: block.thinking });
      else if (block.type === "redacted_thinking") l.log("thinking", { text: "(redacted)" });
      else if (block.type === "text" && block.text.trim()) l.log("text", { text: block.text });
      else if (block.type === "tool_use") l.log("tool_call", { id: block.id, name: block.name, input: block.input });
    }
    const assistant: ModelMessage = { role: "assistant", content: reply.content as Anthropic.ContentBlockParam[] };
    if (reply.stop_reason === "refusal") {
      const details = (reply as { stop_details?: unknown }).stop_details;
      l.log("error", { reason: "refusal", details });
      await l.flush();
      return { messages: [assistant], step, turns: s.turns + 1, failed: `refused: ${JSON.stringify(details ?? null)}` };
    }
    if (reply.stop_reason === "max_tokens") {
      l.log("error", { reason: "max_tokens" });
      await l.flush();
      return { messages: [assistant], step, turns: s.turns + 1, failed: "the reply hit max_tokens" };
    }
    await l.flush();
    return { messages: [assistant], step, turns: s.turns + 1 };
  }

  async function nudge(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const l = log(s, step);
    const def = await definition(s);
    if (s.nudges >= MAX_NUDGES) {
      l.log("error", { reason: `ended ${MAX_NUDGES + 1} times without calling ${def.output}` });
      await l.flush();
      return { step, failed: `ended without calling ${def.output}` };
    }
    const text = `You ended without calling ${def.output}. Finish by calling it now. If the job can't be done, call it with what you have and say why.`;
    l.log("nudge", { text });
    await l.flush();
    return { messages: [{ role: "user", content: text }], step, nudges: s.nudges + 1 };
  }

  /** Pure: pauses for a person when a call would change live data. Kept apart from tools so resuming never re-runs a tool. */
  async function gate(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const gated = toolUses(s.messages).filter((c) => TOOLS.get(c.name)?.effect === "write");
    if (!gated.length) return { step, approvals: null };
    const l = log(s, step);
    const summary = `${gated.length} change(s) to live data: ${gated.map((c) => c.name).join(", ")}`;
    l.log("interrupt", { kind: "approve_tool", summary, calls: gated.map((c) => ({ id: c.id, name: c.name, input: c.input })) });
    await l.flush();
    const decision = interrupt<unknown, Decision>({ kind: "approve_tool", summary, calls: gated.map((c) => ({ id: c.id, name: c.name, input: c.input })) });
    l.log("human", { decision });
    await l.flush();
    return { step, approvals: decision.kind === "approve_tool" ? decision.approved : [] };
  }

  async function tools(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const l = log(s, step);
    const def = await definition(s);
    const allowed = new Set([...def.tools, def.output]);
    const ctx = ctxFor(s, def, step, l);

    const results = await Promise.all(
      toolUses(s.messages).map(async (call) => {
        const started = Date.now();
        const t = TOOLS.get(call.name);
        try {
          if (!t || !allowed.has(call.name)) throw new Error(`${call.name} isn't one of this agent's tools`);
          if (t.effect === "write" && !(s.approvals ?? []).includes(call.id)) throw new Error("declined by the person reviewing");
          const parsed = t.input.safeParse(call.input);
          if (!parsed.success) {
            throw new Error(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}`);
          }
          const out = await t.run(parsed.data, ctx);
          if (t.effect === "output") {
            const r = out as OutputResult;
            return { call, content: r.message, isError: false, ms: Date.now() - started, final: r.final ? r : null };
          }
          return { call, content: typeof out === "string" ? out : JSON.stringify(out), isError: false, ms: Date.now() - started, final: null };
        } catch (err) {
          return { call, content: message(err), isError: true, ms: Date.now() - started, final: null };
        }
      }),
    );

    let output: unknown = s.output;
    for (const r of results) {
      l.log("tool_result", { id: r.call.id, name: r.call.name, isError: r.isError, ms: r.ms, content: r.content });
      if (r.final && r.final.final) {
        output = r.final.output;
        l.log("output", { tool: r.call.name, output });
      }
    }
    await l.flush();
    const content: Anthropic.ToolResultBlockParam[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.call.id,
      content: r.content.length > MAX_RESULT_CHARS ? `${r.content.slice(0, MAX_RESULT_CHARS)}…(trimmed)` : r.content,
      ...(r.isError ? { is_error: true } : {}),
    }));
    // Stuck: every call failed, exactly as in the previous round(s). Stop instead of burning turns.
    const failedAll = results.length > 0 && results.every((r) => r.isError);
    const key = failedAll ? results.map((r) => `${r.call.name}: ${r.content}`).sort().join(" | ") : "";
    const errorStreak = failedAll ? { key, n: s.errorStreak?.key === key ? s.errorStreak.n + 1 : 1 } : null;
    let failed: string | null = null;
    if (errorStreak && errorStreak.n >= MAX_REPEATED_ERRORS && !output) {
      failed = `the same tool error ${errorStreak.n} times in a row: ${key.slice(0, 300)}`;
      l.log("error", { reason: failed });
      await l.flush();
    }
    return { messages: [{ role: "user", content }], step, output, approvals: null, errorStreak, failed };
  }

  /** Pure: the HITL stop, shaped by the output tool (select leads, or approve a draft). */
  async function stop(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const l = log(s, step);
    const def = await definition(s);
    const out = tool(def.output);
    const kind = out.review ?? "approve";
    const summary = out.summarize?.(s.output) ?? `review ${def.name} output`;
    l.log("interrupt", { kind, summary, error: s.stopError });
    await l.flush();
    const decision = interrupt<unknown, Decision>({ kind, summary, output: s.output, error: s.stopError, agent: def.name });
    l.log("human", { decision });
    await l.flush();
    return { step, decision, stopError: null };
  }

  async function finish(s: State): Promise<Partial<State>> {
    const step = s.step + 1;
    const l = log(s, step);
    const def = await definition(s);
    const out = tool(def.output);
    const ctx = ctxFor(s, def, step, l);
    const d = s.decision;
    let outcome = "done";
    let result: unknown = null;

    if (d?.kind === "select") {
      const items = out.items?.(s.output) ?? [];
      const children: { id: string; itemId: string }[] = [];
      for (const itemId of d.selected) {
        const item = items.find((i) => i.id === itemId);
        if (!item || !def.handoff) continue;
        const id = childId(s.executionId, itemId);
        await hooks.spawn(def.handoff, { item: item.value, parent: { agent: def.name, executionId: s.executionId, input: s.input } }, {
          id,
          parentId: s.executionId,
          itemId,
        });
        await writeMemory(ctx, `lead/${itemId}`, { key: "status", kind: "status", status: "researching", text: `selected for research (${id})` });
        children.push({ id, itemId });
      }
      for (const r of d.rejected) {
        await writeMemory(ctx, `lead/${r.id}`, { key: "status", kind: "status", status: "rejected", text: r.reason || "not selected" });
      }
      l.log("handoff", { agent: def.handoff, children });
      outcome = `${children.length} handed to ${def.handoff}, ${d.rejected.length} passed over`;
    } else if (d?.kind === "approve" && d.approve) {
      const write = out.onApprove ? tool(out.onApprove) : null;
      if (write) {
        const parsed = write.input.safeParse(d.payload);
        if (!parsed.success) {
          const error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          l.log("error", { reason: `approval payload invalid: ${error}` });
          await l.flush();
          return { step, stopError: error };
        }
        const callId = `person-${step}`;
        l.log("tool_call", { id: callId, name: write.name, input: parsed.data, by: "person" });
        try {
          result = await write.run(parsed.data, ctx);
          l.log("tool_result", { id: callId, name: write.name, isError: false, content: JSON.stringify(result) });
        } catch (err) {
          l.log("tool_result", { id: callId, name: write.name, isError: true, content: message(err) });
          await l.flush();
          return { step, stopError: message(err) };
        }
        outcome = `approved: ${write.name}`;
      } else {
        outcome = "approved";
      }
    } else if (d?.kind === "approve" && !d.approve) {
      await out.onReject?.(s.output, d.reason, ctx);
      outcome = `rejected: ${d.reason}`;
    }
    l.log("end", { outcome });
    await l.flush();
    return { step, outcome, result };
  }

  return new StateGraph(ExecState)
    .addNode("start", start)
    .addNode("model", model)
    .addNode("nudge", nudge)
    .addNode("gate", gate)
    .addNode("tools", tools)
    .addNode("stop", stop)
    .addNode("finish", finish)
    .addEdge(START, "start")
    .addEdge("start", "model")
    .addConditionalEdges("model", (s: State) => (s.failed ? END : toolUses(s.messages).length ? "gate" : "nudge"), ["gate", "nudge", END])
    .addConditionalEdges("nudge", (s: State) => (s.failed ? END : "model"), ["model", END])
    .addEdge("gate", "tools")
    .addConditionalEdges("tools", (s: State) => (s.failed ? END : s.output ? "stop" : "model"), ["stop", "model", END])
    .addEdge("stop", "finish")
    .addConditionalEdges("finish", (s: State) => (s.stopError ? "stop" : END), ["stop", END])
    .compile({ checkpointer: conn.checkpointer, store });
}

export type Executor = ReturnType<typeof buildExecutor>;
export { childId };
