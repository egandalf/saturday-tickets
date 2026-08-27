import { MongoClient, type Collection, type Document } from "mongodb";
import { dbFromUri, hostFromUri, log, redactUri, sanitize } from "./log";
import type { Place, Surface } from "./places";
import { embedQuery } from "./voyage";

type GlobalMongo = {
  __ticketsMongo?: MongoClient;
  __ticketsMongoPromise?: Promise<MongoClient>;
};

const g = globalThis as typeof globalThis & GlobalMongo;

const SURFACES: Surface[] = ["PAVED", "PACKED GRAVEL"];
const VECTOR_INDEX = "places_vector";
const FAMILY_QUERY =
  "family Saturday from 41144 Greenup Kentucky, paved or packed gravel, back before dusk";

function uri(): string | undefined {
  const value = process.env.MONGODB_URI?.trim();
  return value || undefined;
}

function dbName(connection: string): string {
  return process.env.MONGODB_DB?.trim() || dbFromUri(connection) || "saturday";
}

function summarizeReply(reply: Document): unknown {
  const cursor = reply.cursor as { ns?: string; firstBatch?: Document[]; nextBatch?: Document[] } | undefined;
  if (cursor) {
    const batch = cursor.firstBatch ?? cursor.nextBatch ?? [];
    return {
      ns: cursor.ns,
      n: batch.length,
      ids: batch.map((doc) => doc.id ?? doc._id),
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
    milesFromHome: doc.milesFromHome,
    minutesOut: doc.minutesOut,
    onSiteMinutes: doc.onSiteMinutes,
    turnaround: Boolean(doc.turnaround),
    waterCrossing: Boolean(doc.waterCrossing),
    clayWhenWet: Boolean(doc.clayWhenWet),
    photo: doc.photo,
    photoAlt: typeof doc.photoAlt === "string" ? doc.photoAlt : doc.title,
    credit: typeof doc.credit === "string" ? doc.credit : undefined,
  };
}

function mapped(docs: Document[]): Place[] {
  return docs.map(asPlace).filter((p): p is Place => Boolean(p));
}

async function findPlaces(coll: Collection<Document>, radiusMiles: number, db: string): Promise<Place[]> {
  const filter = {
    milesFromHome: { $lte: radiusMiles },
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
  radiusMiles: number,
  queryText: string,
  db: string,
): Promise<Place[] | null> {
  const queryVector = await embedQuery(queryText);
  if (!queryVector) return null;

  const pipeline: Document[] = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: "embedding",
        queryVector,
        numCandidates: 44,
        limit: 22,
        filter: { milesFromHome: { $lte: radiusMiles } },
      },
    },
    { $project: { embedding: 0, embeddingModel: 0, embeddingDims: 0 } },
  ];

  log.json(
    "mongo.places.vector",
    { index: VECTOR_INDEX, radius: radiusMiles, numCandidates: 44, limit: 22 },
    { db, coll: coll.collectionName },
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

export async function loadPlacesFromAtlas(
  radiusMiles: number,
  queryText = FAMILY_QUERY,
): Promise<AtlasLoad | null> {
  const connection = uri();
  if (!connection) return null;

  const client = await connect();
  if (!client) return null;

  const db = client.db(dbName(connection));
  const coll = db.collection("places");

  const fromVector = await vectorPlaces(coll, radiusMiles, queryText, db.databaseName);
  if (fromVector && fromVector.length) {
    const notes = await db.collection("notes").estimatedDocumentCount();
    log.line("mongo.notes", { count: notes });
    return { places: fromVector, via: "vector" };
  }

  if (fromVector) {
    log.line("mongo.places.vector.empty", { fallback: "find" });
  }

  const places = await findPlaces(coll, radiusMiles, db.databaseName);
  const notes = await db.collection("notes").estimatedDocumentCount();
  log.line("mongo.notes", { count: notes });
  return { places, via: "find" };
}
