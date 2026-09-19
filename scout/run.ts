/**
 * Local only. Run the scout graph and review each candidate in the terminal.
 *
 *   npm run scout -- [--focus=history|lake|woods|town|<free text>] [--count=3]
 *                    [--origin=lat,lng,Label] [--radius=150]
 *   npm run scout -- --thread=<id>     resume a run that was paused at review
 *
 * Run state lives in Atlas scout_checkpoints, so quitting mid-review loses nothing.
 */
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { dbFromUri } from "../lib/log";
import { buildGraph, MODEL, type ReviewRequest } from "./graph";
import { ask, prompter } from "./review-cli";
import { DEFAULT_RUN, parseOrigin, parseRadius, type Run } from "./lib/origin";

function value(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI unset. Run with --env-file=.env.local");
  const resume = value(argv, "thread");
  const threadId = resume ?? randomUUID();
  const run: Run = {
    origin: value(argv, "origin") ? parseOrigin(value(argv, "origin")!) : DEFAULT_RUN.origin,
    radiusMiles: value(argv, "radius") ? parseRadius(value(argv, "radius")!) : DEFAULT_RUN.radiusMiles,
  };
  const count = Number(value(argv, "count") ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("count must be 1-10");

  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "saturday-scout" });
  const rl = prompter();
  try {
    await mongo.connect();
    const db = mongo.db(process.env.MONGODB_DB?.trim() || dbFromUri(uri) || "saturday");
    // Not the app's `checkpoints`: that collection holds deal threads.
    const checkpointer = new MongoDBSaver({
      client: mongo,
      dbName: db.databaseName,
      checkpointCollectionName: "scout_checkpoints",
      checkpointWritesCollectionName: "scout_checkpoint_writes",
    });
    const setupErrors = await checkpointer.setup();
    if (setupErrors.length) throw setupErrors[0];

    const graph = buildGraph(db).compile({ checkpointer });
    const config = { configurable: { thread_id: threadId } };

    if (resume) {
      console.log(`resuming ${threadId}`);
    } else {
      console.log(`scout ${threadId} · ${MODEL} · ${run.origin.label} within ${run.radiusMiles} mi`);
      await graph.invoke({ run, focus: value(argv, "focus") ?? null, count }, config);
    }

    for (;;) {
      const snapshot = await graph.getState(config);
      const pending = snapshot.tasks.flatMap((t) => t.interrupts)[0];
      if (!pending) break;
      const decision = await ask(rl, pending.value as ReviewRequest);
      if (decision === "quit") {
        console.log(`\npaused. Resume with: npm run scout -- --thread=${threadId}`);
        return;
      }
      await graph.invoke(new Command({ resume: decision }), config);
    }
    console.log("done.");
  } finally {
    rl.close();
    await mongo.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
