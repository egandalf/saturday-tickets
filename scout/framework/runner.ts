/**
 * Starts, resumes, and settles executions. Each execution is its own LangGraph thread
 * (thread_id = execution id), so it pauses, resumes, and fails on its own. The UI and the CLI
 * both drive the framework through here.
 */
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { Command } from "@langchain/langgraph";
import type { Db } from "mongodb";
import { currentVersion, seedAgents } from "./agents";
import { logger } from "./events";
import { buildExecutor, type Executor } from "./executor";
import { connect, type Connection } from "./store";
import { tool } from "./tools/index";
import type { AgentDefinition, Decision, Execution, Waiting } from "./types";

const MAX_CONCURRENT = 2;
/** LangGraph counts every node as a step; the executor's maxTurns check is the real bound. */
const RECURSION_LIMIT = 400;

export type Framework = Connection & {
  graph: Executor;
  /** Executions this process has queued or is running; a "running" one not in here has stalled. */
  inFlight: Set<string>;
  schedule: (id: string, go: () => Promise<unknown>) => void;
  close: () => Promise<void>;
};

type Job = { id: string; go: () => Promise<unknown> };

function config(id: string) {
  return { configurable: { thread_id: id }, recursionLimit: RECURSION_LIMIT };
}

export async function openFramework(options: { client?: Anthropic; echo?: boolean } = {}): Promise<Framework> {
  const conn = await connect({ client: options.client });
  await seedAgents(conn.db);
  const queue: Job[] = [];
  const inFlight = new Set<string>();
  let running = 0;
  const executions = conn.db.collection<Execution>("executions");

  const fw = { ...conn, inFlight, close: () => conn.mongo.close() } as Framework;
  // Every execution runs in this (clean) async context. A child spawned from inside a parent's
  // node would otherwise inherit LangGraph's run context and behave like a subgraph: its pauses
  // would surface as errors in a parent that has already finished.
  const detached = AsyncResource.bind((fn: () => void) => fn());

  const pump = () => {
    while (running < MAX_CONCURRENT && queue.length) {
      const job = queue.shift()!;
      running++;
      detached(() => void (async () => {
        await executions.updateOne({ _id: job.id }, { $set: { status: "running", waiting: null, updatedAt: new Date() } });
        try {
          await job.go();
          await settle(fw, job.id);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await executions.updateOne({ _id: job.id }, { $set: { status: "failed", error, updatedAt: new Date() } });
          const l = logger(conn.db, job.id, 9999);
          l.log("error", { reason: error });
          await l.flush();
        } finally {
          running--;
          inFlight.delete(job.id);
          pump();
        }
      })());
    }
  };
  fw.schedule = (id, go) => {
    if (inFlight.has(id)) throw new Error(`execution ${id} is already queued or running`);
    inFlight.add(id);
    queue.push({ id, go });
    pump();
  };

  fw.graph = buildExecutor(conn, {
    echo: options.echo,
    isCancelled: async (id) => (await executions.findOne({ _id: id }, { projection: { status: 1 } }))?.status === "cancelled",
    spawn: async (agent, input, link) => {
      await startExecution(fw, agent, input, link);
    },
  });
  return fw;
}

function waitingFrom(value: { kind?: string; summary?: string; error?: string | null }): Waiting {
  const summary = value.summary ?? "waiting for a person";
  if (value.kind === "select") return { kind: "select", summary };
  if (value.kind === "approve_tool") return { kind: "approve_tool", summary };
  return { kind: "approve", summary, ...(value.error ? { error: value.error } : {}) };
}

/** Read where the thread ended up and record it on the execution. */
async function settle(fw: Framework, id: string): Promise<void> {
  const snapshot = await fw.graph.getState(config(id));
  const pending = snapshot.tasks.flatMap((t) => t.interrupts)[0];
  const values = snapshot.values as { failed?: string | null; outcome?: string | null };
  const executions = fw.db.collection<Execution>("executions");
  const current = await executions.findOne({ _id: id }, { projection: { status: 1 } });
  if (current?.status === "cancelled") return;
  const set: Partial<Execution> = pending
    ? { status: "waiting", waiting: waitingFrom(pending.value as Record<string, string>), error: null }
    : values.failed
      ? { status: "failed", error: values.failed, waiting: null }
      : { status: "done", outcome: values.outcome ?? "done", waiting: null, error: null };
  await executions.updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() } });
}

function checkInput(def: AgentDefinition, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.input) {
    let v = input[f.name];
    if ((v === undefined || v === "" || v === null) && f.default !== undefined) v = f.default;
    if ((v === undefined || v === "" || v === null) && f.required) throw new Error(`input "${f.name}" is required`);
    if (v === undefined || v === "") continue;
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`input "${f.name}" must be a number`);
      v = n;
    }
    if (f.type === "json" && typeof v === "string") v = JSON.parse(v);
    out[f.name] = v;
  }
  return out;
}

export async function startExecution(
  fw: Framework,
  agent: string,
  input: Record<string, unknown>,
  link: { id?: string; parentId?: string; itemId?: string } = {},
): Promise<string> {
  const version = await currentVersion(fw.db, agent);
  const def = version.definition;
  tool(def.output); // fail early if the definition points at a missing tool
  const clean = checkInput(def, input);
  const id = link.id ?? randomUUID();
  const executions = fw.db.collection<Execution>("executions");
  if (await executions.findOne({ _id: id })) return id;
  const parent = link.parentId ? await executions.findOne({ _id: link.parentId }, { projection: { rootId: 1 } }) : null;
  const now = new Date();
  await executions.insertOne({
    _id: id,
    agent,
    version: version.version,
    input: clean,
    parentId: link.parentId ?? null,
    rootId: parent?.rootId ?? id,
    itemId: link.itemId ?? null,
    status: "queued",
    waiting: null,
    outcome: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  fw.schedule(id, () => fw.graph.invoke({ executionId: id, versionId: version._id, input: clean }, config(id)));
  return id;
}

/** Answer a paused execution's stop (select leads, approve or reject, approve tool calls). */
export async function resumeExecution(fw: Framework, id: string, decision: Decision): Promise<void> {
  const exec = await fw.db.collection<Execution>("executions").findOne({ _id: id });
  if (!exec) throw new Error(`no execution ${id}`);
  if (exec.status !== "waiting") throw new Error(`execution ${id} is ${exec.status}, not waiting`);
  fw.schedule(id, () => fw.graph.invoke(new Command({ resume: decision }), config(id)));
}

/**
 * Continue a run that stopped mid-step (the process died, or an error): picks up from its last
 * checkpoint. One already paused at a stop is just re-recorded as waiting.
 */
export async function continueExecution(fw: Framework, id: string): Promise<void> {
  const snapshot = await fw.graph.getState(config(id));
  if (!snapshot.config?.configurable?.checkpoint_id) throw new Error(`execution ${id} has no checkpoint to continue from`);
  const paused = snapshot.tasks.some((t) => t.interrupts.length);
  fw.schedule(id, () => (paused ? Promise.resolve() : fw.graph.invoke(null, config(id))));
}

export async function cancelExecution(db: Db, id: string): Promise<void> {
  await db.collection<Execution>("executions").updateOne(
    { _id: id, status: { $in: ["queued", "running", "waiting"] } },
    { $set: { status: "cancelled", waiting: null, updatedAt: new Date() } },
  );
}

/** Wait until an execution is no longer queued or running (CLI and tests). */
export async function until(fw: Framework, id: string, pollMs = 1000): Promise<Execution> {
  for (;;) {
    const exec = await fw.db.collection<Execution>("executions").findOne({ _id: id });
    if (!exec) throw new Error(`no execution ${id}`);
    if (!["queued", "running"].includes(exec.status) && !fw.inFlight.has(id)) return exec;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** The paused stop's payload (what the person is deciding on). */
export async function pendingStop(fw: Framework, id: string): Promise<Record<string, unknown> | null> {
  const snapshot = await fw.graph.getState(config(id));
  const pending = snapshot.tasks.flatMap((t) => t.interrupts)[0];
  return (pending?.value as Record<string, unknown>) ?? null;
}

export async function stateOf(fw: Framework, id: string): Promise<Record<string, unknown>> {
  return (await fw.graph.getState(config(id))).values as Record<string, unknown>;
}
