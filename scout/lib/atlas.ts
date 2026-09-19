import { MongoClient, type Db } from "mongodb";
import { dbFromUri } from "../../lib/log";

/** Open the saturday db for one command, then close. Scout is a CLI, not a warm serverless function. */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI unset. Run with --env-file=.env.local");
  const name = process.env.MONGODB_DB?.trim() || dbFromUri(uri) || "saturday";
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "saturday-scout" });
  try {
    await client.connect();
    return await fn(client.db(name));
  } finally {
    await client.close();
  }
}
