/** Terminal review: one card per candidate, answers read from a buffered line iterator. */
import { createInterface } from "node:readline";
import type { ReviewRequest } from "./graph";
import { KINDS, type Decision, type Scouted } from "./lib/candidate";
import { describe, isError } from "./lib/enrich";
import { APP_HOME, straightMiles } from "./lib/origin";
import { duskOk, longestSaturday } from "./lib/place-doc";

type Kind = (typeof KINDS)[number];

/**
 * Answers come from a buffered line iterator opened at the first question, so nothing typed
 * or piped during discovery is dropped.
 */
export function prompter() {
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

export type Prompter = ReturnType<typeof prompter>;

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
    ...enrichmentLines(c),
  ];
  console.log(lines.filter((l) => l !== null).join("\n"));
}

function enrichmentLines(c: Scouted): string[] {
  const { summary, flags } = describe(c.enrichment);
  const lines = [`   open data: ${summary}`, ...flags.map((f) => `   ⚑ ${f}`)];
  const route = c.enrichment.route;
  if (!isError(route) && !duskOk({ minutesOut: route.minutes, onSiteMinutes: c.onSiteMinutes })) {
    lines.push(`   ⚑ home after dusk even on ${longestSaturday(APP_HOME).date}, leaving at 10: kept, never dealt from home`);
  }
  const photos = isError(c.enrichment.photos) ? [] : c.enrichment.photos;
  photos.forEach((p, i) => lines.push(`   📷 ${i + 1}. ${p.title} · ${p.credit} · ${p.meters} m · ${p.pageUrl}`));
  return lines;
}

export async function ask(rl: Prompter, request: ReviewRequest): Promise<Decision | "quit"> {
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
      const photos = isError(c.enrichment.photos) ? [] : c.enrichment.photos;
      let photo: number | null = null;
      if (photos.length) {
        const picked = (await rl.question(`   photo [1-${photos.length}, 0 for none; default 1] › `)).trim();
        const n = picked ? Number(picked) : 1;
        photo = Number.isInteger(n) && n >= 1 && n <= photos.length ? n - 1 : null;
      }
      const note = (await rl.question("   note (optional) › ")).trim() || null;
      return { id: c.id, decision: "accept", tags, note, photo };
    }
  }
}
