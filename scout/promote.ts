/**
 * Local only. Turn accepted candidates into places. The scout UI does the same on its Promote page.
 *
 *   npm run scout:promote             dry run: each accepted candidate as a place, and what is still unknown
 *   npm run scout:promote -- --write  ask for the unknowns, copy the photo to Blob, embed, upsert,
 *                                     and add the tags to lib/places.ts for you to review and commit
 */
import { withDb } from "./lib/atlas";
import type { CandidateDoc } from "./lib/candidate";
import { describe } from "./lib/enrich";
import { blockers, draft, promote, waiting, type Answers, type Draft, type Field } from "./lib/promote-core";
import { prompter, type Prompter } from "./review-cli";

function show(c: CandidateDoc, d: Draft): string[] {
  const field = (name: string, f: Field<unknown>) => `    ${name.padEnd(13)} ${f.value === null ? "?" : String(f.value)}  (${f.why})`;
  return [
    `\n${c.id} · ${c.title} · tags ${c.tags?.join(", ") ?? "none"}`,
    `    drive        ${Math.round(d.route.miles)} mi, ${d.route.minutes} min from home`,
    field("surface", d.surface),
    field("turnaround", d.turnaround),
    field("clayWhenWet", d.clayWhenWet),
    field("waterCrossing", d.waterCrossing),
    `    photo        ${d.photo ? `${d.photo.credit} · ${d.photo.source}` : "?  (none chosen)"}`,
    ...describe(c.enrichment).flags.map((f) => `    ⚑ ${f}`),
  ];
}

async function yesNo(rl: Prompter, question: string): Promise<boolean | undefined> {
  const answer = (await rl.question(`    ${question} [y/n, blank to skip this place] › `)).trim().toLowerCase();
  return answer === "y" ? true : answer === "n" ? false : undefined;
}

async function answer(rl: Prompter, d: Draft): Promise<Answers | null> {
  const a: Answers = {};
  if (d.waterCrossing.value === null) return null;
  if (d.surface.value === null) {
    const s = (await rl.question("    surface to parking [p]aved / [g]ravel (packed), blank to skip › ")).trim().toLowerCase();
    if (s !== "p" && s !== "g") return null;
    a.surface = s === "p" ? "PAVED" : "PACKED GRAVEL";
  }
  if (d.turnaround.value === null && (a.turnaround = await yesNo(rl, "room to turn a full-size vehicle around?")) === undefined) return null;
  if (d.clayWhenWet.value === null && (a.clayWhenWet = await yesNo(rl, "any clay that turns slick after rain?")) === undefined) return null;
  if (!d.photo) {
    const source = (await rl.question("    photo: URL or path to a landscape .jpg, blank to skip › ")).trim();
    if (!source) return null;
    const credit = (await rl.question("    credit (e.g. your name, or Author (CC BY 4.0)) › ")).trim();
    const alt = (await rl.question("    alt text: what the photo shows › ")).trim();
    a.photo = { source, alt, credit };
  } else {
    const alt = (await rl.question(`    alt text [${d.photo.alt}] › `)).trim();
    if (alt) a.photo = { ...d.photo, alt };
  }
  return a;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const rl = prompter();
  try {
    await withDb(async (db) => {
      const docs = await waiting(db);
      console.log(`${docs.length} accepted candidate(s) waiting`);
      for (const c of docs) {
        const d = await draft(c);
        console.log(show(c, d).join("\n"));
        if (!write) continue;
        const a = await answer(rl, d);
        const blocked = a ? blockers(d, a) : blockers(d);
        if (!a || blocked.length) {
          console.log(`    left in candidates${blocked.length ? `: ${blocked.join("; ")}` : ""}`);
          continue;
        }
        if ((await rl.question("    promote to places? [y/N] › ")).trim().toLowerCase() !== "y") continue;
        try {
          const done = await promote(db, c, d, a);
          console.log(`    promoted · photo ${done.photoUrl}`);
          for (const [kind, ids] of Object.entries(done.tagsAdded)) console.log(`    lib/places.ts ${kind}: + ${ids.join(", ")}`);
        } catch (err) {
          console.log(`    ✗ ${err instanceof Error ? err.message : err}`);
        }
      }
      console.log(write ? "\nreview lib/places.ts with git diff, then commit." : "\ndry run. Add --write to fill the unknowns and promote.");
    });
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
