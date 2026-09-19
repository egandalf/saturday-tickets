/**
 * Local only. Re-embed every place in Atlas with the current model and embedText format.
 *
 *   npm run scout:reembed             dry run: show what would change
 *   npm run scout:reembed -- --write  embed all places in one batch and update them
 *
 * Run it with the deploy that changes the query model: vectors from different models don't compare.
 */
import type { Document } from "mongodb";
import { withDb } from "./lib/atlas";
import { EMBED_MODEL, embedText } from "./lib/place-doc";
import { embedDocuments } from "./lib/voyage";

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  await withDb(async (db) => {
    const places = db.collection("places");
    const docs: Document[] = await places.find({}, { projection: { embedding: 0 } }).sort({ milesFromHome: 1 }).toArray();
    const models = new Map<string, number>();
    for (const doc of docs) models.set(String(doc.embeddingModel), (models.get(String(doc.embeddingModel)) ?? 0) + 1);
    console.log(`${docs.length} places; now: ${[...models].map(([m, n]) => `${m} ×${n}`).join(", ")} → ${EMBED_MODEL}`);
    for (const doc of docs) console.log(`  ${String(doc.id).padEnd(20)} ${embedText(doc as Parameters<typeof embedText>[0])}`);
    if (!write) {
      console.log("dry run. Add --write to re-embed.");
      return;
    }

    const vecs = await embedDocuments(docs.map((doc) => embedText(doc as Parameters<typeof embedText>[0])));
    const now = new Date();
    const result = await places.bulkWrite(
      docs.map((doc, i) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { embedding: vecs[i], embeddingModel: EMBED_MODEL, embeddingDims: vecs[i].length, embeddedAt: now } },
        },
      })),
    );
    console.log(`re-embedded ${result.modifiedCount} of ${docs.length} (${vecs[0].length} dims, ${EMBED_MODEL})`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
