/** Local only. Snapshot Atlas `places` (no vectors) with signed tags from code, before scout writes anything. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MongoClient, type Document } from "mongodb";
import { dbFromUri } from "../lib/log";
import { signedTags } from "../lib/places";

const OUT = join(import.meta.dirname, "data", "places.baseline.json");

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI unset. Run with --env-file=.env.local");
  const dbName = process.env.MONGODB_DB?.trim() || dbFromUri(uri) || "saturday";

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "saturday-scout" });
  try {
    await client.connect();
    const docs: Document[] = await client
      .db(dbName)
      .collection("places")
      .find({}, { projection: { _id: 0, embedding: 0 } })
      .sort({ milesFromHome: 1, id: 1 })
      .toArray();

    const places = docs.map((doc) => ({ ...doc, signedTags: signedTags(String(doc.id)) }));
    const untagged = docs.filter((doc) => !signedTags(String(doc.id)).length).map((doc) => String(doc.id));

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify({ exportedAt: new Date().toISOString(), db: dbName, count: places.length, places }, null, 2) + "\n",
    );
    console.log(`wrote ${places.length} places to ${OUT}`);
    if (untagged.length) console.log(`untagged in code: ${untagged.join(", ")}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
