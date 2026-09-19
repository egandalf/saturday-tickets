/** Embed and upsert validated places by id. Shared by scout:upsert and scout:promote. */
import type { Collection, Document } from "mongodb";
import type { Run } from "./origin";
import { duskOk, EMBED_MODEL, embedText, type PlaceDoc, type PlaceInput } from "./place-doc";
import { embedDocuments } from "./voyage";

export async function upsertPlaces(
  coll: Collection<Document>,
  places: PlaceInput[],
  run: Run,
): Promise<{ inserted: number; replaced: number; dims: number }> {
  if (!places.length) return { inserted: 0, replaced: 0, dims: 0 };
  const vecs = await embedDocuments(places.map(embedText));
  const now = new Date();
  const result = await coll.bulkWrite(
    places.map((p, i) => {
      const doc: PlaceDoc = {
        ...p,
        duskOk: duskOk(p),
        scoutedFrom: run,
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
  return { inserted: result.upsertedCount, replaced: result.modifiedCount, dims: vecs[0].length };
}
