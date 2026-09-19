/**
 * Scout runs as records: start one, watch its log, save review decisions as drafts, and finish
 * the review in one resume. The CLI and the scout UI share this, so a review started in one
 * can finish in the other.
 *
 * Collections: scout_runs (one per thread), scout_events (the progress log), and LangGraph's
 * scout_checkpoints / scout_checkpoint_writes.
 */
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { Command } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient, type Db } from "mongodb";
import { dbFromUri } from "../../lib/log";
import { buildGraph, type ReviewRequest } from "../graph";
import type { Decision } from "./candidate";
import type { Run } from "./origin";

export type RunParams = { run: Run; focus: string | null; count: number };

export type RunStatus = "running" | "review" | "done" | "failed";

export type RunDoc = {
  threadId: string;
  params: RunParams;
  status: RunStatus;
  startedAt: Date;
  updatedAt: Date;
  error?: string;
  candidates?: number;
  drafts: Record<string, Decision>;
};

export type EventDoc = { threadId: string; at: Date; line: string };

export type Pending = { interruptId: string; request: ReviewRequest };

type Graph = ReturnType<ReturnType<typeof buildGraph>["compile"]>;

export type Scout = { mongo: MongoClient; db: Db; graph: Graph; close: () => Promise<void> };

export async function openScout(options: { echo?: boolean; client?: Anthropic } = {}): Promise<Scout> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI unset");
  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "saturday-scout" });
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB?.trim() || dbFromUri(uri) || "saturday");
  // Not the app's `checkpoints`: that collection holds deal threads.
  const checkpointer = new MongoDBSaver({
    client: mongo,
    dbName: db.databaseName,
    checkpointCollectionName: "scout_checkpoints",
    checkpointWritesCollectionName: "scout_checkpoint_writes",
  });
  const errors = await checkpointer.setup();
  if (errors.length) throw errors[0];

  const events = db.collection<EventDoc>("scout_events");
  const runs = db.collection<RunDoc>("scout_runs");
  const emit = (threadId: string, line: string) => {
    if (options.echo) console.log(line);
    const at = new Date();
    void events.insertOne({ threadId, at, line }).catch(() => {});
    void runs.updateOne({ threadId }, { $set: { updatedAt: at } }).catch(() => {});
  };
  const graph = buildGraph(db, { emit, client: options.client }).compile({ checkpointer });
  return { mongo, db, graph, close: () => mongo.close() };
}

function config(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

async function settle(scout: Scout, threadId: string): Promise<void> {
  const open = await pending(scout, threadId);
  const snapshot = await scout.graph.getState(config(threadId));
  const candidates = (snapshot.values.candidates as unknown[] | undefined)?.length ?? 0;
  await scout.db
    .collection<RunDoc>("scout_runs")
    .updateOne({ threadId }, { $set: { status: open.length ? "review" : "done", candidates, updatedAt: new Date() } });
}

/** Starts discovery. `done` settles when the graph pauses for review or ends. */
export async function startRun(scout: Scout, params: RunParams): Promise<{ threadId: string; done: Promise<void> }> {
  const threadId = randomUUID();
  const now = new Date();
  const runs = scout.db.collection<RunDoc>("scout_runs");
  await runs.insertOne({ threadId, params, status: "running", startedAt: now, updatedAt: now, drafts: {} });
  const done = scout.graph
    .invoke({ run: params.run, focus: params.focus, count: params.count }, config(threadId))
    .then(() => settle(scout, threadId))
    .catch(async (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      await runs.updateOne({ threadId }, { $set: { status: "failed", error, updatedAt: new Date() } });
      throw err;
    });
  return { threadId, done };
}

export async function pending(scout: Scout, threadId: string): Promise<Pending[]> {
  const snapshot = await scout.graph.getState(config(threadId));
  return snapshot.tasks
    .flatMap((t) => t.interrupts)
    .filter((i) => i.id && i.value)
    .map((i) => ({ interruptId: i.id!, request: i.value as ReviewRequest }))
    .sort((a, b) => a.request.index - b.request.index);
}

export async function getRun(db: Db, threadId: string): Promise<RunDoc | null> {
  return db.collection<RunDoc>("scout_runs").findOne({ threadId }, { projection: { _id: 0 } });
}

export async function listRuns(db: Db, limit = 30): Promise<RunDoc[]> {
  return db.collection<RunDoc>("scout_runs").find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray();
}

export async function events(db: Db, threadId: string, limit = 500): Promise<EventDoc[]> {
  return db.collection<EventDoc>("scout_events").find({ threadId }, { projection: { _id: 0 } }).sort({ _id: 1 }).limit(limit).toArray();
}

export async function saveDraft(db: Db, threadId: string, candidateId: string, decision: Decision | null): Promise<void> {
  const key = `drafts.${candidateId}`;
  const now = new Date();
  await db
    .collection("scout_runs")
    .updateOne({ threadId }, decision ? { $set: { [key]: decision, updatedAt: now } } : { $unset: { [key]: "" as const }, $set: { updatedAt: now } });
}

/** Resume every review pause at once with the saved drafts, then stage the decisions. */
export async function finishReview(scout: Scout, threadId: string): Promise<void> {
  const run = await getRun(scout.db, threadId);
  if (!run) throw new Error(`no run ${threadId}`);
  const open = await pending(scout, threadId);
  const missing = open.filter((p) => !run.drafts[p.request.candidate.id]);
  if (missing.length) throw new Error(`still to decide: ${missing.map((p) => p.request.candidate.title).join(", ")}`);
  const resume = Object.fromEntries(open.map((p) => [p.interruptId, run.drafts[p.request.candidate.id]]));
  await scout.graph.invoke(new Command({ resume }), config(threadId));
  await settle(scout, threadId);
}
