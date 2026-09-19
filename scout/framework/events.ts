/**
 * The audit log. Each node writes its events under its step number with a running index, and
 * the id is execution:step:index, so a node that replays (on resume, or after a crash) rewrites
 * the same events instead of adding duplicates.
 */
import type { Db } from "mongodb";
import type { EventType, ExecutionEvent } from "./types";

export type Logger = {
  log: (type: EventType, data: Record<string, unknown>) => void;
  flush: () => Promise<void>;
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function logger(db: Db, executionId: string, step: number, echo = false): Logger {
  const events = db.collection<ExecutionEvent>("execution_events");
  const writes: Promise<unknown>[] = [];
  let index = 0;
  return {
    log(type, data) {
      const i = index++;
      const _id = `${executionId}:${pad(step, 4)}:${pad(i, 3)}`;
      const doc: ExecutionEvent = { _id, executionId, step, index: i, at: new Date(), type, data };
      if (echo) console.log(`[${executionId.slice(0, 8)} ${step}.${i}] ${type} ${summarize(type, data)}`);
      writes.push(events.replaceOne({ _id }, doc, { upsert: true }));
    },
    async flush() {
      await Promise.all(writes.splice(0));
    },
  };
}

export async function eventsOf(db: Db, executionId: string): Promise<ExecutionEvent[]> {
  return db.collection<ExecutionEvent>("execution_events").find({ executionId }).sort({ step: 1, index: 1 }).toArray();
}

/** One line for terminals and list views. */
export function summarize(type: EventType, data: Record<string, unknown>): string {
  const clip = (s: unknown, n = 140) => {
    const text = typeof s === "string" ? s : JSON.stringify(s);
    return text.length > n ? `${text.slice(0, n)}…` : text;
  };
  switch (type) {
    case "tool_call":
      return `${data.name} ${clip(data.input)}`;
    case "tool_result":
      return `${data.name}${data.isError ? " ERROR" : ""} ${clip(data.content)}`;
    case "thinking":
    case "text":
      return clip(data.text, 200);
    case "llm_call":
      return `${data.model} ${data.stopReason} in ${data.ms}ms, ${JSON.stringify(data.usage)}`;
    default:
      return clip(data);
  }
}
