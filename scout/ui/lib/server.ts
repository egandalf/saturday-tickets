/** Server-side handle for the scout UI: one framework (Mongo, graph, runner) per dev server. */
import "./env";
import type { Db } from "mongodb";
import { eventsOf } from "../../framework/events";
import { openFramework, pendingStop, stateOf, type Framework } from "../../framework/runner";
import type { Execution } from "../../framework/types";
import type { ExecutionView, Stop } from "./types";

const g = globalThis as typeof globalThis & { __framework?: Promise<Framework> };

export function getFramework(): Promise<Framework> {
  g.__framework ??= openFramework().catch((err) => {
    g.__framework = undefined;
    throw err;
  });
  return g.__framework;
}

export async function getDb(): Promise<Db> {
  return (await getFramework()).db;
}

/** JSON-safe copy for client components (Dates become strings). */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function executionView(id: string): Promise<ExecutionView | null> {
  const fw = await getFramework();
  const executions = fw.db.collection<Execution>("executions");
  const execution = await executions.findOne({ _id: id });
  if (!execution) return null;
  const [events, children, parent, stop, state] = await Promise.all([
    eventsOf(fw.db, id),
    executions.find({ parentId: id }).sort({ createdAt: 1 }).toArray(),
    execution.parentId ? executions.findOne({ _id: execution.parentId }) : null,
    execution.status === "waiting" ? pendingStop(fw, id) : null,
    stateOf(fw, id),
  ]);
  return plain({
    execution,
    events,
    children,
    parent,
    stop: stop as Stop | null,
    result: (state.result as unknown) ?? null,
    stalled: ["queued", "running"].includes(execution.status) && !fw.inFlight.has(id),
  });
}
