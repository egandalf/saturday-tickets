import { MongoClient, type Document } from "mongodb";
import { dbFromUri, hostFromUri, log, redactUri, sanitize } from "./log";
import type { Place, Surface } from "./places";

type GlobalMongo = {
  __ticketsMongo?: MongoClient;
  __ticketsMongoPromise?: Promise<MongoClient>;
};

const g = globalThis as typeof globalThis & GlobalMongo;

const SURFACES: Surface[] = ["PAVED", "PACKED GRAVEL"];

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

export type RetrieveResult = {
  places: Place[];
  source: "atlas" | "seed";
  reason?: string;
};

export async function loadPlacesFromAtlas(radiusMiles: number): Promise<Place[] | null> {
  const connection = uri();
  if (!connection) return null;

  const client = await connect();
  if (!client) return null;

  const db = client.db(dbName(connection));
  const filter = {
    milesFromHome: { $lte: radiusMiles },
    photo: { $type: "string", $ne: "" },
    surface: { $in: SURFACES },
  };

  log.json("mongo.places.find", filter, { db: db.databaseName, coll: "places" });

  const started = Date.now();
  const docs = await db.collection("places").find(filter).toArray();
  const places = docs.map(asPlace).filter((p): p is Place => Boolean(p));
  const skipped = docs.length - places.length;

  log.line("mongo.places.result", {
    ms: Date.now() - started,
    docs: docs.length,
    mapped: places.length,
    skipped,
    ids: places.map((p) => p.id),
  });

  const notes = await db.collection("notes").estimatedDocumentCount();
  log.line("mongo.notes", { count: notes });

  return places;
}
