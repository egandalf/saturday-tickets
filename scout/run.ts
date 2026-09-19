/**
 * Local only. Run the scout graph and review each candidate in the terminal.
 * The scout UI (npm run scout:ui) does the same with photos and a map.
 *
 *   npm run scout -- [--focus=history|lake|woods|town|<free text>] [--count=3]
 *                    [--origin=lat,lng,Label] [--radius=150]
 *   npm run scout -- --thread=<id>     resume a review, here or one started in the UI
 *
 * Decisions save as drafts as you go, so quitting mid-review loses nothing.
 */
import { MODEL } from "./graph";
import { DEFAULT_RUN, parseOrigin, parseRadius, type Run } from "./lib/origin";
import { finishReview, getRun, openScout, pending, saveDraft, startRun } from "./lib/runs";
import { ask, prompter } from "./review-cli";

function value(argv: string[], name: string): string | undefined {
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const run: Run = {
    origin: value(argv, "origin") ? parseOrigin(value(argv, "origin")!) : DEFAULT_RUN.origin,
    radiusMiles: value(argv, "radius") ? parseRadius(value(argv, "radius")!) : DEFAULT_RUN.radiusMiles,
  };
  const count = Number(value(argv, "count") ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("count must be 1-10");

  const scout = await openScout({ echo: true });
  const rl = prompter();
  try {
    let threadId = value(argv, "thread");
    if (threadId) {
      console.log(`resuming ${threadId}`);
    } else {
      console.log(`${MODEL} · ${run.origin.label} within ${run.radiusMiles} mi`);
      const started = await startRun(scout, { run, focus: value(argv, "focus") ?? null, count });
      threadId = started.threadId;
      console.log(`scout ${threadId}`);
      await started.done;
    }

    const open = await pending(scout, threadId);
    const drafts = (await getRun(scout.db, threadId))?.drafts ?? {};
    for (const p of open) {
      if (drafts[p.request.candidate.id]) continue;
      const decision = await ask(rl, p.request);
      if (decision === "quit") {
        console.log(`\npaused. Resume with: npm run scout -- --thread=${threadId}`);
        return;
      }
      await saveDraft(scout.db, threadId, p.request.candidate.id, decision);
    }
    if (open.length) await finishReview(scout, threadId);
    console.log("done.");
  } finally {
    rl.close();
    await scout.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
