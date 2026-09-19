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
import { createInterface } from "node:readline";
import { Command } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { dbFromUri } from "../lib/log";
import { buildGraph, MODEL, type ReviewRequest } from "./graph";
import { KINDS, type Decision } from "./lib/candidate";
import { APP_HOME, DEFAULT_RUN, parseOrigin, parseRadius, straightMiles, type Run } from "./lib/origin";

type Kind = (typeof KINDS)[number];

function value(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/**
 * Answers come from a buffered line iterator opened at the first question, so nothing typed
 * or piped during discovery is dropped.
 */
function prompter() {
  let lines: AsyncIterator<string> | undefined;
  let close = () => {};
  return {
    async question(text: string): Promise<string> {
      if (!lines) {
        const rl = createInterface({ input: process.stdin, terminal: false });
        lines = rl[Symbol.asyncIterator]();
        close = () => rl.close();
      }
      process.stdout.write(text);
      const next = await lines.next();
      if (next.done) throw new Error("input closed before an answer");
      if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`);
      return next.value;
    },
    close: () => close(),
  };
}

type Prompter = ReturnType<typeof prompter>;

function printCard({ index, total, candidate: c, run }: ReviewRequest): void {
  const fromHome = straightMiles(APP_HOME, c.location).toFixed(0);
  const fromOrigin = straightMiles(run.origin, c.location).toFixed(0);
  const lines = [
    ``,
    `── ${index + 1} of ${total} ── ${c.title}  (${c.id})`,
    `   ${c.summary}`,
    `   kinds: ${c.kinds.join(", ")}   on site: ${c.onSiteMinutes} min`,
    `   at ${c.location.lat}, ${c.location.lng} · ${fromHome} mi straight-line from home${run.origin.label === APP_HOME.label ? "" : `, ${fromOrigin} from ${run.origin.label}`}`,
    `   coords from: ${c.locationSource}`,
    c.address ? `   address: ${c.address}` : null,
    `   surface: ${c.surface}   turnaround: ${c.turnaround}   clay when wet: ${c.clayWhenWet}   water crossing: ${c.waterCrossing}`,
    c.waterCrossingNotes ? `   crossing: ${c.waterCrossingNotes}` : null,
    c.seasonNote ? `   season: ${c.seasonNote}` : null,
    ...c.concerns.map((x) => `   ⚠ ${x}`),
    ...c.sources.map((s) => `   · ${s}`),
  ];
  console.log(lines.filter((l) => l !== null).join("\n"));
}

async function ask(rl: Prompter, request: ReviewRequest): Promise<Decision | "quit"> {
  printCard(request);
  const c = request.candidate;
  for (;;) {
    const answer = (await rl.question("   [a]ccept  [r]eject  [s]kip  [q]uit for now › ")).trim().toLowerCase();
    if (answer === "q") return "quit";
    if (answer === "s") return { id: c.id, decision: "skip" };
    if (answer === "r") {
      const reason = (await rl.question("   reason › ")).trim() || "not a fit";
      return { id: c.id, decision: "reject", reason };
    }
    if (answer === "a") {
      const typed = (await rl.question(`   tags [${c.kinds.join(",")}] › `)).trim();
      const tags = (typed ? typed.split(/[\s,]+/) : c.kinds).filter((t): t is Kind => (KINDS as readonly string[]).includes(t));
      if (!tags.length) {
        console.log(`   tags must be from: ${KINDS.join(", ")}`);
        continue;
      }
      const note = (await rl.question("   note (optional) › ")).trim() || null;
      return { id: c.id, decision: "accept", tags, note };
    }
  }
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
