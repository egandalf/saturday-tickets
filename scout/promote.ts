/**
 * Local only. Turn accepted candidates into places.
 *
 *   npm run scout:promote             dry run: each accepted candidate as a place, and what is still unknown
 *   npm run scout:promote -- --write  ask for the unknowns, copy the photo to Blob, embed, upsert,
 *                                     and add the tags to lib/places.ts for you to review and commit
 *
 * Fields come from the candidate, then from open data (the routed drive, the mapped approach,
 * parking), and only what neither settles is asked. A place with a water crossing waits for a
 * full waterCrossingAssessment; promote doesn't draft one yet.
 */
import type { Document } from "mongodb";
import { withDb } from "./lib/atlas";
import type { CandidateDoc, KINDS } from "./lib/candidate";
import { describe, isError, routeFromHome, type RouteFacts } from "./lib/enrich";
import { deletePhoto, storePhoto } from "./lib/photos";
import { DEFAULT_RUN } from "./lib/origin";
import { formatIssues, placeInput, type PlaceInput } from "./lib/place-doc";
import { signTags } from "./lib/sign-tags";
import { upsertPlaces } from "./lib/write-places";
import { prompter, type Prompter } from "./review-cli";

type Kind = (typeof KINDS)[number];
type Surface = PlaceInput["surface"];

/** What a candidate settles on its own; null means a person has to answer. */
type Draft = {
  surface: { value: Surface | null; why: string };
  turnaround: { value: boolean | null; why: string };
  clayWhenWet: { value: boolean | null; why: string };
  waterCrossing: { value: false | null; why: string };
  photo: { source: string; alt: string; credit: string } | null;
  route: RouteFacts;
};

async function draft(c: CandidateDoc): Promise<Draft> {
  const route = isError(c.enrichment.route) ? await routeFromHome(c.location) : c.enrichment.route;
  const lots = isError(c.enrichment.parking) ? 0 : c.enrichment.parking.lots.length;

  const surface: Draft["surface"] =
    c.surface !== "UNKNOWN"
      ? { value: c.surface, why: "from the sources" }
      : route.suggestedSurface === "PAVED" || route.suggestedSurface === "PACKED GRAVEL"
        ? { value: route.suggestedSurface, why: "from the mapped approach" }
        : { value: null, why: `sources silent; mapped approach reads ${route.suggestedSurface}` };

  const turnaround: Draft["turnaround"] =
    c.turnaround === "yes"
      ? { value: true, why: "from the sources" }
      : lots
        ? { value: true, why: `${lots} mapped parking lot(s) at the spot` }
        : { value: null, why: "sources silent and no parking mapped" };

  const clayWhenWet: Draft["clayWhenWet"] =
    c.clayWhenWet === "no"
      ? { value: false, why: "from the sources" }
      : surface.value === "PAVED" && route.approach.rough === 0
        ? { value: false, why: "paved approach, nothing rough mapped" }
        : { value: null, why: "unpaved or unmapped approach" };

  const waterCrossing: Draft["waterCrossing"] =
    c.waterCrossing === "established" || route.fords.length
      ? { value: null, why: route.fords.length ? "the route crosses a ford" : "sources name an established crossing" }
      : { value: false, why: c.waterCrossing === "none" ? "from the sources" : "no ford on the routed approach" };

  const photo = c.photo
    ? { source: c.photo.url, alt: c.photo.description || c.photo.title, credit: c.photo.credit }
    : null;

  return { surface, turnaround, clayWhenWet, waterCrossing, photo, route };
}

function toPlace(c: CandidateDoc, d: Draft, photoUrl: string): Record<string, unknown> {
  return {
    id: c.id,
    title: c.title,
    surface: d.surface.value,
    location: { type: "Point", coordinates: [c.location.lng, c.location.lat] },
    milesFromHome: Math.round(d.route.miles),
    minutesOut: d.route.minutes,
    onSiteMinutes: c.onSiteMinutes,
    turnaround: d.turnaround.value,
    waterCrossing: d.waterCrossing.value,
    clayWhenWet: d.clayWhenWet.value,
    photo: photoUrl,
    photoAlt: d.photo?.alt,
    credit: d.photo?.credit,
    ...(c.reviewNote ? { note: c.reviewNote } : {}),
  };
}

function show(c: CandidateDoc, d: Draft): string[] {
  const field = (name: string, f: { value: unknown; why: string }) =>
    `    ${name.padEnd(13)} ${f.value === null ? "?" : String(f.value)}  (${f.why})`;
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

async function yesNo(rl: Prompter, question: string): Promise<boolean | null> {
  const answer = (await rl.question(`    ${question} [y/n, blank to skip this place] › `)).trim().toLowerCase();
  return answer === "y" ? true : answer === "n" ? false : null;
}

/** Fill what's unknown. Returns false to leave the candidate for another day. */
async function resolve(rl: Prompter, c: CandidateDoc, d: Draft): Promise<boolean> {
  if (d.waterCrossing.value === null) {
    console.log(`    skipped: ${d.waterCrossing.why}; needs a waterCrossingAssessment before it can be a place`);
    return false;
  }
  if (d.surface.value === null) {
    const a = (await rl.question("    surface to parking [p]aved / [g]ravel (packed), blank to skip › ")).trim().toLowerCase();
    if (a !== "p" && a !== "g") return false;
    d.surface = { value: a === "p" ? "PAVED" : "PACKED GRAVEL", why: "you" };
  }
  if (d.turnaround.value === null) {
    const a = await yesNo(rl, "room to turn a full-size vehicle around?");
    if (a !== true) return false;
    d.turnaround = { value: true, why: "you" };
  }
  if (d.clayWhenWet.value === null) {
    const a = await yesNo(rl, "any clay that turns slick after rain?");
    if (a !== false) return false;
    d.clayWhenWet = { value: false, why: "you" };
  }
  if (!d.photo) {
    const source = (await rl.question("    photo: URL or path to a landscape .jpg, blank to skip › ")).trim();
    if (!source) return false;
    const credit = (await rl.question("    credit (e.g. your name, or Author (CC BY 4.0)) › ")).trim();
    const alt = (await rl.question("    alt text: what the photo shows › ")).trim();
    if (!credit || !alt) return false;
    d.photo = { source, alt, credit };
  } else {
    const alt = (await rl.question(`    alt text [${d.photo.alt}] › `)).trim();
    if (alt) d.photo.alt = alt;
  }
  return true;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const rl = prompter();
  try {
    await withDb(async (db) => {
      const candidates = db.collection<Document>("candidates");
      const docs = (await candidates
        .find({ status: "accepted", promotedAt: { $exists: false } })
        .toArray()) as unknown as CandidateDoc[];
      console.log(`${docs.length} accepted candidate(s) waiting`);

      const promoted: { c: CandidateDoc; place: PlaceInput }[] = [];
      for (const c of docs) {
        const d = await draft(c);
        console.log(show(c, d).join("\n"));
        if (!write) continue;
        if (!(await resolve(rl, c, d))) {
          console.log("    left in candidates");
          continue;
        }

        const schema = placeInput(c.scoutedFrom ?? DEFAULT_RUN);
        const check = schema.safeParse(toPlace(c, d, "https://placeholder.invalid/photo.jpg"));
        if (!check.success) {
          for (const line of formatIssues(check.error)) console.log(`    ✗ ${line}`);
          continue;
        }
        const go = (await rl.question("    promote to places? [y/N] › ")).trim().toLowerCase();
        if (go !== "y") continue;

        const url = await storePhoto(c.id, d.photo!.source);
        const parsed = schema.safeParse(toPlace(c, d, url));
        if (!parsed.success) {
          await deletePhoto(url);
          for (const line of formatIssues(parsed.error)) console.log(`    ✗ ${line}`);
          continue;
        }
        promoted.push({ c, place: parsed.data });
        console.log(`    photo → ${url}`);
      }

      if (!write) {
        console.log("\ndry run. Add --write to fill the unknowns and promote.");
        return;
      }
      if (!promoted.length) return;

      const byRun = new Map<string, { run: CandidateDoc["scoutedFrom"]; places: PlaceInput[] }>();
      for (const { c, place } of promoted) {
        const key = JSON.stringify(c.scoutedFrom ?? DEFAULT_RUN);
        const group = byRun.get(key) ?? { run: c.scoutedFrom ?? DEFAULT_RUN, places: [] };
        group.places.push(place);
        byRun.set(key, group);
      }
      const coll = db.collection("places");
      for (const { run, places } of byRun.values()) {
        const result = await upsertPlaces(coll, places, run);
        console.log(`places: ${result.inserted} inserted, ${result.replaced} replaced`);
      }
      const now = new Date();
      await candidates.updateMany({ id: { $in: promoted.map((p) => p.c.id) } }, { $set: { promotedAt: now } });

      const added = await signTags(promoted.map(({ c }) => ({ id: c.id, tags: (c.tags ?? []) as Kind[] })));
      const lines = Object.entries(added).map(([kind, ids]) => `  ${kind}: ${ids.join(", ")}`);
      console.log(
        lines.length
          ? `lib/places.ts signed tags added (review with git diff, then commit):\n${lines.join("\n")}`
          : "no tags to add",
      );
    });
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
