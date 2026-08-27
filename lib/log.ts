import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type Store = { dealId: string };

const store = new AsyncLocalStorage<Store>();

const SECRET_KEY = /pass|pwd|secret|token|key|authorization|credentials|uri/i;
const VECTOR_KEY = /embedding|vector/i;

export function dealId(): string {
  return store.getStore()?.dealId ?? "--------";
}

export function withDeal<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ dealId: randomUUID().slice(0, 8) }, fn);
}

export function redactUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, "//***@");
}

export function hostFromUri(uri: string): string {
  const m = uri.match(/@([^/?]+)/);
  return m?.[1] ?? "(unknown host)";
}

export function dbFromUri(uri: string): string | undefined {
  const m = uri.match(/\.net\/([^?]+)/);
  const name = m?.[1]?.replace(/\/$/, "");
  return name || undefined;
}

export function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "***";
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === "number") return `[${value.length} floats]`;
    return value.map((item) => sanitize(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = VECTOR_KEY.test(k) ? "[vector]" : sanitize(v, k);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 400) {
    return `${value.slice(0, 160)}…(${value.length} chars)`;
  }
  return value;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function head(scope: string): string {
  return `tickets │ ${stamp()} │ ${dealId()} │ ${scope}`;
}

function dump(data: unknown): void {
  const text = JSON.stringify(sanitize(data), null, 2);
  for (const line of text.split("\n")) {
    console.log(`tickets │            │ ${dealId()} │   ${line}`);
  }
}

function kv(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => {
      if (v === undefined) return null;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return `${k}=${v}`;
      }
      return `${k}=${JSON.stringify(sanitize(v))}`;
    })
    .filter(Boolean)
    .join("  ");
}

export const log = {
  line(scope: string, fields?: Record<string, unknown>) {
    const extra = fields ? `  ${kv(fields)}` : "";
    console.log(`${head(scope)}${extra}`);
  },
  json(scope: string, data: unknown, fields?: Record<string, unknown>) {
    log.line(scope, fields);
    dump(data);
  },
  error(scope: string, err: unknown, fields?: Record<string, unknown>) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "Error";
    console.error(`${head(scope)}  ${kv({ ...fields, name, message })}`);
    if (err instanceof Error && err.stack) {
      for (const line of err.stack.split("\n").slice(0, 8)) {
        console.error(`tickets │            │ ${dealId()} │   ${line.trim()}`);
      }
    }
  },
};
