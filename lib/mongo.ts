import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { dbFromUri, hostFromUri, log, redactUri, sanitize } from "./log";
import { signedTags, type Kind, type Place, type Surface } from "./places";
import { embedQuery } from "./voyage";

type GlobalMongo = {
  __ticketsMongo?: MongoClient;
  __ticketsMongoPromise?: Promise<MongoClient>;
  __ticketsTravelIndex?: Promise<string>;
};

const g = globalThis as typeof globalThis & GlobalMongo;

const SURFACES: Surface[] = ["PAVED", "PACKED GRAVEL"];
const VECTOR_INDEX = "places_vector";
const EMBED_MODEL = "voyage-3.5-lite";
/** Origin-neutral: where the family starts is applied after retrieval, by routing. */
const FAMILY_QUERY = "family Saturday day trip, paved or packed gravel, back before dusk";
/** Every place at today's size. When places grow, prefilter by distance (2dsphere) and pass the ids to $vectorSearch as a filter. */
const VECTOR_LIMIT = 200;

function uri(): string | undefined {
  const value = process.env.MONGODB_URI?.trim();
  return value || undefined;
}

function dbName(connection: string): string {
  return process.env.MONGODB_DB?.trim() || dbFromUri(connection) || "saturday";
}

function summarizeReply(reply: unknown): unknown {
  const doc = reply as Document;
  const cursor = doc.cursor as { ns?: string; firstBatch?: Document[]; nextBatch?: Document[] } | undefined;
  if (cursor) {
    const batch = cursor.firstBatch ?? cursor.nextBatch ?? [];
    return {
      ns: cursor.ns,
      n: batch.length,
      ids: batch.map((row) => row.id ?? row._id),
    };
  }
  return sanitize(reply);
}

function attachMonitors(client: MongoClient): void {
  client.on("commandStarted", (event) => {
    log.json("mongo.command", event.command, {
      name: event.commandName,
      db: event.databaseName,
      requestId: event.requestId,
    });
  });
  client.on("commandSucceeded", (event) => {
    log.json("mongo.ok", summarizeReply(event.reply), {
      name: event.commandName,
      ms: event.duration,
      requestId: event.requestId,
    });
  });
  client.on("commandFailed", (event) => {
    log.error("mongo.fail", event.failure, {
      name: event.commandName,
      ms: event.duration,
      requestId: event.requestId,
    });
  });
  client.on("connectionPoolCreated", (event) => {
    log.line("mongo.pool", { address: event.address });
  });
  client.on("connectionCheckedOut", (event) => {
    log.line("mongo.conn.out", { address: event.address });
  });
  client.on("connectionCheckedIn", (event) => {
    log.line("mongo.conn.in", { address: event.address });
  });
  client.on("serverOpening", (event) => {
    log.line("mongo.server.open", { address: event.address });
  });
  client.on("topologyOpening", () => {
    log.line("mongo.topology.open");
  });
}

async function connect(): Promise<MongoClient | null> {
  const connection = uri();
  if (!connection) {
    log.line("mongo.skip", { reason: "MONGODB_URI unset" });
    return null;
  }

  log.line("mongo.connect", {
    uri: redactUri(connection),
    host: hostFromUri(connection),
    db: dbName(connection),
  });

  if (!g.__ticketsMongoPromise) {
    const client = new MongoClient(connection, {
      monitorCommands: true,
      serverSelectionTimeoutMS: 8000,
      appName: "saturday-tickets",
    });
    attachMonitors(client);
    g.__ticketsMongoPromise = client.connect().then((connected) => {
      g.__ticketsMongo = connected;
      log.line("mongo.ready", { host: hostFromUri(connection) });
      return connected;
    });
  }

  try {
    return await g.__ticketsMongoPromise;
  } catch (err) {
    g.__ticketsMongoPromise = undefined;
    log.error("mongo.connect.fail", err);
    return null;
  }
}

async function database(): Promise<Db | null> {
  const connection = uri();
  if (!connection) return null;
  const client = await connect();
  if (!client) return null;
  return client.db(dbName(connection));
}

async function cachedQueryEmbed(database: Db, text: string): Promise<number[] | null> {
  const doc = await database.collection("query_embeds").findOne({ text, model: EMBED_MODEL });
  const vec = doc?.vec;
  if (Array.isArray(vec) && vec.length) {
    log.line("voyage.mongo.cache", { dims: vec.length, model: EMBED_MODEL });
    return vec as number[];
  }
  return null;
}

async function saveQueryEmbed(database: Db, text: string, vec: number[]): Promise<void> {
  await database.collection("query_embeds").updateOne(
    { text, model: EMBED_MODEL },
    { $set: { text, model: EMBED_MODEL, vec, dims: vec.length, updatedAt: new Date() } },
    { upsert: true },
  );
}

function asTags(doc: Document): Kind[] | undefined {
  if (typeof doc.id !== "string") return undefined;
  const signed = signedTags(doc.id);
  return signed.length ? signed : undefined;
}

function asPlace(doc: Document): Place | null {
  const surface = doc.surface;
  if (surface !== "PAVED" && surface !== "PACKED GRAVEL") return null;
  if (typeof doc.id !== "string" || typeof doc.title !== "string") return null;
  if (typeof doc.photo !== "string" || !doc.photo) return null;
  if (typeof doc.milesFromHome !== "number" || typeof doc.minutesOut !== "number") return null;
  if (typeof doc.onSiteMinutes !== "number") return null;
  return {
    id: doc.id,
    title: doc.title,
    surface,
    tags: asTags(doc),
    milesFromHome: doc.milesFromHome,
    minutesOut: doc.minutesOut,
    onSiteMinutes: doc.onSiteMinutes,
    turnaround: Boolean(doc.turnaround),
    waterCrossing: Boolean(doc.waterCrossing),
    clayWhenWet: Boolean(doc.clayWhenWet),
    photo: doc.photo,
    photoAlt: typeof doc.photoAlt === "string" ? doc.photoAlt : doc.title,
    credit: typeof doc.credit === "string" ? doc.credit : undefined,
    location: asLocation(doc.location),
  };
}

function asLocation(value: unknown): Place["location"] {
  const coords = (value as { coordinates?: unknown } | undefined)?.coordinates;
  if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") return undefined;
  return { lat: coords[1], lng: coords[0] };
}

function mapped(docs: Document[]): Place[] {
  return docs.map(asPlace).filter((p): p is Place => Boolean(p));
}

async function findPlaces(coll: Collection<Document>, db: string): Promise<Place[]> {
  const filter = {
    photo: { $type: "string", $ne: "" },
    surface: { $in: SURFACES },
  };

  log.json("mongo.places.find", filter, { db, coll: coll.collectionName });

  const started = Date.now();
  const docs = await coll.find(filter).toArray();
  const places = mapped(docs);
  log.line("mongo.places.result", {
    via: "find",
    ms: Date.now() - started,
    docs: docs.length,
    mapped: places.length,
    skipped: docs.length - places.length,
    ids: places.map((p) => p.id),
  });
  return places;
}

async function vectorPlaces(
  coll: Collection<Document>,
  queryText: string,
  database: Db,
): Promise<Place[] | null> {
  let queryVector = await embedQuery(queryText);
  if (!queryVector) queryVector = await cachedQueryEmbed(database, queryText);
  else {
    try {
      await saveQueryEmbed(database, queryText, queryVector);
    } catch (err) {
      log.error("voyage.mongo.cache.save.fail", err);
    }
  }
  if (!queryVector) return null;

  const pipeline: Document[] = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: "embedding",
        queryVector,
        numCandidates: VECTOR_LIMIT * 2,
        limit: VECTOR_LIMIT,
      },
    },
    { $project: { embedding: 0, embeddingModel: 0, embeddingDims: 0 } },
  ];

  log.json(
    "mongo.places.vector",
    { index: VECTOR_INDEX, numCandidates: VECTOR_LIMIT * 2, limit: VECTOR_LIMIT },
    { db: database.databaseName, coll: coll.collectionName },
  );

  const started = Date.now();
  try {
    const docs = await coll.aggregate(pipeline).toArray();
    const places = mapped(docs);
    log.line("mongo.places.result", {
      via: "vector",
      ms: Date.now() - started,
      docs: docs.length,
      mapped: places.length,
      skipped: docs.length - places.length,
      ids: places.map((p) => p.id),
    });
    return places;
  } catch (err) {
    log.error("mongo.places.vector.fail", err, { ms: Date.now() - started });
    return null;
  }
}

export type AtlasLoad = {
  places: Place[];
  via: "vector" | "find";
};

/** Every dealable place, ranked by the family embed. Distance from the origin is applied by the deal. */
export async function loadPlacesFromAtlas(queryText = FAMILY_QUERY): Promise<AtlasLoad | null> {
  const connection = uri();
  if (!connection) return null;

  const client = await connect();
  if (!client) return null;

  const db = client.db(dbName(connection));
  const coll = db.collection("places");

  const fromVector = await vectorPlaces(coll, queryText, db);
  if (fromVector && fromVector.length) {
    const notes = await db.collection("notes").estimatedDocumentCount();
    log.line("mongo.notes", { count: notes });
    return { places: fromVector, via: "vector" };
  }

  if (fromVector) {
    log.line("mongo.places.vector.empty", { fallback: "find" });
  }

  const places = await findPlaces(coll, db.databaseName);
  const notes = await db.collection("notes").estimatedDocumentCount();
  log.line("mongo.notes", { count: notes });
  return { places, via: "find" };
}

function noteText(doc: Document): string | null {
  if (typeof doc.text === "string" && doc.text.trim()) return doc.text.trim();
  if (typeof doc.body === "string" && doc.body.trim()) return doc.body.trim();
  if (typeof doc.note === "string" && doc.note.trim()) return doc.note.trim();
  return null;
}

export async function loadNotesFromAtlas(): Promise<string[]> {
  const db = await database();
  if (!db) {
    log.line("load.notes", { source: "unset", count: 0 });
    return [];
  }
  const docs = await db.collection("notes").find({}).sort({ at: -1 }).limit(20).toArray();
  const notes = docs.map(noteText).filter((n): n is string => Boolean(n));
  log.line("load.notes", { source: "atlas", count: notes.length });
  return notes;
}

export async function appendNote(text: string): Promise<void> {
  const db = await database();
  if (!db) return;
  await db.collection("notes").insertOne({ text, at: new Date() });
}

export async function loadCheckpoint(threadId: string): Promise<Document | null> {
  const db = await database();
  if (!db) return null;
  return db.collection("checkpoints").findOne({ threadId });
}

export async function saveCheckpoint(threadId: string, state: Document): Promise<void> {
  const db = await database();
  if (!db) return;
  await db.collection("checkpoints").updateOne(
    { threadId },
    { $set: { ...state, threadId, updatedAt: new Date() } },
    { upsert: true },
  );
}

export type TravelCacheDoc = { _id: string; miles: number; minutes: number; at: Date };

const TRAVEL_TTL_SECONDS = 30 * 24 * 3600;

/** Drive times already routed from an origin (key "lat,lng:placeId"); expire after 30 days. */
export async function readTravelCache(ids: string[]): Promise<TravelCacheDoc[]> {
  const db = await database();
  if (!db || !ids.length) return [];
  const coll = db.collection<TravelCacheDoc>("travel_cache");
  if (!g.__ticketsTravelIndex) {
    g.__ticketsTravelIndex = coll.createIndex({ at: 1 }, { expireAfterSeconds: TRAVEL_TTL_SECONDS }).catch(() => "");
  }
  return coll.find({ _id: { $in: ids } }).toArray();
}

export async function writeTravelCache(docs: TravelCacheDoc[]): Promise<void> {
  const db = await database();
  if (!db || !docs.length) return;
  await db.collection<TravelCacheDoc>("travel_cache").bulkWrite(
    docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
  );
}
