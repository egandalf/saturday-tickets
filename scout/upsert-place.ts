/**
 * Local only. Validate places from a JSON file (one object or an array), embed, and upsert into Atlas.
 *
 *   npm run scout:upsert -- scout/data/new.json             dry run: validate, show embed text
 *   npm run scout:upsert -- scout/data/new.json --write     embed and write new ids
 *   npm run scout:upsert -- scout/data/new.json --write --replace   also overwrite existing ids
 *   --origin=lat,lng[,label] --radius=miles   where this batch was scouted (default 41144, 150 mi)
 *   --collection=places_scratch   write somewhere other than the live places (for testing)
 *
 * milesFromHome and minutesOut are always from 41144. A place scouted on vacation is kept;
 * the deal leaves it out while it is past the radius or home after dusk.
 *
 * Tags stay signed in lib/places.ts. An untagged place is stored but only deals with no mood.
 */
import { readFile } from "node:fs/promises";
import { signedTags } from "../lib/places";
import { withDb } from "./lib/atlas";
import { APP_HOME, DEFAULT_RUN, parseOrigin, parseRadius, type Run } from "./lib/origin";
import {
  backAt,
  duskOk,
  EMBED_MODEL,
  embedText,
  formatIssues,
  longestSaturday,
  placeInput,
  type PlaceDoc,
  type PlaceInput,
  type WaterCrossingAssessment,
} from "./lib/place-doc";
import { embedDocuments } from "./lib/voyage";

type Args = { file: string; write: boolean; replace: boolean; collection: string; run: Run };

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const file = argv.find((a) => !a.startsWith("--"));
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const collection = value("collection") || "places";
  const originText = value("origin");
  const radiusText = value("radius");
  const run: Run = {
    origin: originText ? parseOrigin(originText) : DEFAULT_RUN.origin,
    radiusMiles: radiusText ? parseRadius(radiusText) : DEFAULT_RUN.radiusMiles,
  };
  if (!file) throw new Error("usage: scout:upsert -- <places.json> [--write] [--replace] [--origin=lat,lng] [--radius=mi]");
  return { file, write: flags.has("--write"), replace: flags.has("--replace"), collection, run };
}

function printCrossing(a: WaterCrossingAssessment): void {
  const [lng, lat] = a.location.coordinates;
  console.log(`    water crossing: ${a.kind} over ${a.waterway}, ~${a.typicalDepthInches} in, at ${lat},${lng}`);
  console.log(`      where: ${a.where}`);
  console.log(`      closes when: ${a.closesWhen}`);
  console.log(`      bypass: ${a.bypass ?? "none"} · gauge: ${a.usgsGauge ? `USGS ${a.usgsGauge}` : "none"}`);
  for (const risk of a.risks) console.log(`      risk: ${risk}`);
  console.log(`      sources (${a.assessedAt}): ${a.sources.join(" ")}`);
}

function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw: unknown = JSON.parse(await readFile(args.file, "utf8"));
  const items = Array.isArray(raw) ? raw : [raw];

  const schema = placeInput(args.run);
  const valid: PlaceInput[] = [];
  let invalid = 0;
  for (const [i, item] of items.entries()) {
    const parsed = schema.safeParse(item);
    const label = (item as { id?: unknown })?.id ?? `#${i}`;
    if (!parsed.success) {
      invalid++;
      console.log(`✗ ${label}`);
      for (const line of formatIssues(parsed.error)) console.log(`    ${line}`);
      continue;
    }
    valid.push(parsed.data);
  }

  const dusk = longestSaturday(APP_HOME);
  console.log(`scouted from ${args.run.origin.label} (${args.run.origin.lat},${args.run.origin.lng}) within ${args.run.radiusMiles} mi\n`);
  await withDb(async (db) => {
    const coll = db.collection(args.collection);
    const ids = valid.map((p) => p.id);
    const existing = new Set(
      (await coll.find({ id: { $in: ids } }, { projection: { id: 1 } }).toArray()).map((d) => String(d.id)),
    );

    const toWrite: PlaceInput[] = [];
    for (const p of valid) {
      const exists = existing.has(p.id);
      const action = exists && !args.replace ? "skip (exists; --replace to overwrite)" : exists ? "replace" : "insert";
      const tags = signedTags(p.id);
      console.log(`✓ ${p.id}  ${action}`);
      const reach = duskOk(p) ? `home ${clock(backAt(p))}` : `home ${clock(backAt(p))}, after dusk all year: kept, never dealt from ${APP_HOME.label}`;
      console.log(`    ${p.title} · ${p.surface} · ${p.milesFromHome} mi from home · ${reach} (latest dusk ${dusk.clock})`);
      console.log(`    tags: ${tags.length ? tags.join(", ") : "none signed; add the id to lib/places.ts"}`);
      if (p.waterCrossingAssessment) printCrossing(p.waterCrossingAssessment);
      console.log(`    embed: ${embedText(p)}`);
      if (!exists || args.replace) toWrite.push(p);
    }

    console.log(`\n${valid.length} valid, ${invalid} invalid, ${toWrite.length} to write → ${db.databaseName}.${args.collection}`);
    if (!args.write) {
      console.log("dry run. Add --write to embed and upsert.");
      return;
    }
    if (!toWrite.length) return;

    const vecs = await embedDocuments(toWrite.map(embedText));
    const now = new Date();
    const result = await coll.bulkWrite(
      toWrite.map((p, i) => {
        const doc: PlaceDoc = {
          ...p,
          duskOk: duskOk(p),
          scoutedFrom: args.run,
          embedding: vecs[i],
          embeddingModel: EMBED_MODEL,
          embeddingDims: vecs[i].length,
        };
        const absent = (["note", "waterCrossingAssessment"] as const).filter((k) => p[k] === undefined);
        const unset = absent.length ? { $unset: Object.fromEntries(absent.map((k) => [k, ""])) } : {};
        return {
          updateOne: {
            filter: { id: p.id },
            update: { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now }, ...unset },
            upsert: true,
          },
        };
      }),
    );
    console.log(`wrote: ${result.upsertedCount} inserted, ${result.modifiedCount} replaced (${vecs[0].length} dims)`);
  });

  if (invalid) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
