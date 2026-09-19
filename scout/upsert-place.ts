/**
 * Local only. Validate places from a JSON file (one object or an array), embed, and upsert into Atlas.
 *
 *   npm run scout:upsert -- scout/data/new.json             dry run: validate, show embed text
 *   npm run scout:upsert -- scout/data/new.json --write     embed and write new ids
 *   npm run scout:upsert -- scout/data/new.json --write --replace   also overwrite existing ids
 *   --collection=places_scratch   write somewhere other than the live places (for testing)
 *
 * Tags stay signed in lib/places.ts. An untagged place is stored but only deals with no mood.
 */
import { readFile } from "node:fs/promises";
import { signedTags } from "../lib/places";
import { withDb } from "./lib/atlas";
import {
  backAt,
  EMBED_MODEL,
  embedText,
  formatIssues,
  longestSaturday,
  PlaceInput,
  type PlaceDoc,
} from "./lib/place-doc";
import { embedDocuments } from "./lib/voyage";

type Args = { file: string; write: boolean; replace: boolean; collection: string };

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const file = argv.find((a) => !a.startsWith("--"));
  const collection = argv.find((a) => a.startsWith("--collection="))?.split("=")[1] || "places";
  if (!file) throw new Error("usage: scout:upsert -- <places.json> [--write] [--replace]");
  return { file, write: flags.has("--write"), replace: flags.has("--replace"), collection };
}

function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw: unknown = JSON.parse(await readFile(args.file, "utf8"));
  const items = Array.isArray(raw) ? raw : [raw];

  const valid: PlaceInput[] = [];
  let invalid = 0;
  for (const [i, item] of items.entries()) {
    const parsed = PlaceInput.safeParse(item);
    const label = (item as { id?: unknown })?.id ?? `#${i}`;
    if (!parsed.success) {
      invalid++;
      console.log(`✗ ${label}`);
      for (const line of formatIssues(parsed.error)) console.log(`    ${line}`);
      continue;
    }
    valid.push(parsed.data);
  }

  const dusk = longestSaturday();
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
      console.log(`    ${p.title} · ${p.surface} · ${p.milesFromHome} mi · home ${clock(backAt(p))} (latest dusk ${dusk.clock} on ${dusk.date})`);
      console.log(`    tags: ${tags.length ? tags.join(", ") : "none signed; add the id to lib/places.ts"}`);
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
          duskOk: true,
          embedding: vecs[i],
          embeddingModel: EMBED_MODEL,
          embeddingDims: vecs[i].length,
        };
        const unset = p.note === undefined ? { $unset: { note: "" } } : {};
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
