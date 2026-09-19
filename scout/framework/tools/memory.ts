/**
 * Traceable memory on LangGraph's store. Namespaces are written "kind/id" (e.g. "place/greenbo",
 * "lead/buckeye-furnace", "agent/research/lessons"); every value records the execution and step
 * that wrote it, so the UI can link a memory back to its moment in the audit log.
 */
import { randomUUID } from "node:crypto";
import type { BaseStore } from "@langchain/langgraph";
import { z } from "zod";
import type { Memory, ToolContext, ToolDef } from "../types";

export function namespaceOf(text: string): string[] {
  return text
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type Recalled = { namespace: string; key: string } & Memory;

export async function recallFrom(store: BaseStore, namespace: string, contains?: string, limit = 30): Promise<Recalled[]> {
  const items = await store.search(namespaceOf(namespace), { limit: 200 });
  const needle = contains?.trim().toLowerCase();
  return items
    .map((i) => ({ namespace: i.namespace.join("/"), key: i.key, ...(i.value as Memory) }))
    .filter((m) => !needle || m.text.toLowerCase().includes(needle))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export async function writeMemory(
  ctx: Pick<ToolContext, "memory" | "executionId" | "agent" | "step" | "log">,
  namespace: string,
  memory: { text: string; source?: string | null; kind?: string; key?: string; [extra: string]: unknown },
): Promise<string> {
  const { key: given, text, source, kind, ...extra } = memory;
  const key = given ?? randomUUID().slice(0, 8);
  const value: Memory = {
    ...extra,
    text,
    source: source ?? null,
    kind: kind ?? "fact",
    executionId: ctx.executionId,
    agent: ctx.agent,
    step: ctx.step,
    at: new Date().toISOString(),
  };
  await ctx.memory.put(namespaceOf(namespace), key, value);
  ctx.log("memory_write", { namespace, key, text, source: value.source, kind: value.kind });
  return key;
}

export const recall: ToolDef<{ namespace: string; contains?: string }> = {
  name: "recall",
  description:
    'Read memories under a namespace prefix ("place/greenbo", "lead", "agent/research/lessons"), newest first, optionally filtered by text. Each says who wrote it, when, and from what source.',
  effect: "read",
  input: z.object({ namespace: z.string().min(1), contains: z.string().optional() }),
  run: async ({ namespace, contains }, ctx) => {
    const found = await recallFrom(ctx.memory, namespace, contains);
    ctx.log("memory_read", { namespace, contains: contains ?? null, keys: found.map((m) => `${m.namespace}:${m.key}`) });
    return found.map(({ namespace: ns, key, text, source, agent, at }) => ({ namespace: ns, key, text, source, agent, at }));
  },
};

export const remember: ToolDef<{ namespace: string; text: string; source?: string | null; key?: string }> = {
  name: "remember",
  description:
    'Keep a durable fact for later runs, with its source URL. Use "place/<id>" or "lead/<id>" for facts about one place, "agent/<your name>/lessons" for what you learned about doing this job. Reusing a key replaces that memory.',
  effect: "stage",
  input: z.object({
    namespace: z.string().min(3),
    text: z.string().min(8),
    source: z.string().nullable().optional(),
    key: z.string().regex(/^[a-z0-9-]+$/).optional(),
  }),
  run: async ({ namespace, text, source, key }, ctx) => {
    const saved = await writeMemory(ctx, namespace, { text, source, key });
    return { saved: `${namespace}:${saved}` };
  },
};
