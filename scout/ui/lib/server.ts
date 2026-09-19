/** Server-side handles for the scout UI: one Mongo connection and compiled graph per dev server. */
import "./env";
import type { Db } from "mongodb";
import { describe } from "../../lib/enrich";
import { APP_HOME } from "../../lib/origin";
import { duskOk, longestSaturday } from "../../lib/place-doc";
import { events, getRun, openScout, pending, type RunDoc, type Scout } from "../../lib/runs";
import type { CardData, RunView } from "./types";

type Globals = { __scout?: Promise<Scout>; __locating?: boolean };
const g = globalThis as typeof globalThis & Globals;

export function getScout(): Promise<Scout> {
  g.__scout ??= openScout().catch((err) => {
    g.__scout = undefined;
    throw err;
  });
  return g.__scout;
}

export async function getDb(): Promise<Db> {
  return (await getScout()).db;
}

export const locating = {
  get active(): boolean {
    return Boolean(g.__locating);
  },
  set active(value: boolean) {
    g.__locating = value;
  },
};

/** JSON-safe copy for client components (Dates become strings). */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function runView(threadId: string): Promise<RunView | null> {
  const scout = await getScout();
  const run = await getRun(scout.db, threadId);
  if (!run) return null;
  const open = run.status === "review" ? await pending(scout, threadId) : [];
  const dusk = longestSaturday(APP_HOME);
  const cards: CardData[] = open.map(({ request }) => {
    const { summary, flags } = describe(request.candidate.enrichment);
    const route = request.candidate.enrichment.route;
    if (!("error" in route) && !duskOk({ minutesOut: route.minutes, onSiteMinutes: request.candidate.onSiteMinutes })) {
      flags.push(`home after dusk even on ${dusk.date}, leaving at 10: kept, never dealt from home`);
    }
    return { request, summary, flags };
  });
  return plain({ run: run as RunDoc, events: await events(scout.db, threadId), cards });
}
