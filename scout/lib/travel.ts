/**
 * Stored vs routed travel for existing places, from scout:locate's findings in
 * scout/data/locations.json. Applying keeps the old values on the place as travelPrevious.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import { signedTags } from "../../lib/places";
import type { RouteFacts } from "./enrich";
import { APP_HOME } from "./origin";
import { SCOUT_DATA } from "./paths";
import { backAt, duskOk } from "./place-doc";

export const LOCATIONS = join(SCOUT_DATA, "locations.json");

export type Located = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  what: string;
  source: string;
  route: RouteFacts;
  at: string;
};

export type TravelRow = {
  id: string;
  title: string;
  photo: string;
  tags: string[];
  surface: string;
  onSiteMinutes: number;
  stored: { miles: number; minutes: number; homeBy: number };
  routed: null | {
    miles: number;
    minutes: number;
    homeBy: number;
    duskOk: boolean;
    snapMiles: number;
    lat: number;
    lng: number;
    what: string;
    source: string;
    at: string;
  };
  applied: boolean;
};

export async function loadLocations(): Promise<Record<string, Located>> {
  return existsSync(LOCATIONS) ? (JSON.parse(await readFile(LOCATIONS, "utf8")) as Record<string, Located>) : {};
}

export async function saveLocations(all: Record<string, Located>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(LOCATIONS, JSON.stringify(sorted, null, 2) + "\n");
}

export async function travelRows(db: Db): Promise<TravelRow[]> {
  const found = await loadLocations();
  const docs = await db.collection("places").find({}, { projection: { embedding: 0 } }).sort({ milesFromHome: 1 }).toArray();
  return docs.map((doc) => {
    const onSite = Number(doc.onSiteMinutes);
    const hit = found[String(doc.id)];
    const minutes = hit?.route.minutes ?? 0;
    return {
      id: String(doc.id),
      title: String(doc.title),
      photo: String(doc.photo),
      tags: signedTags(String(doc.id)),
      surface: String(doc.surface),
      onSiteMinutes: onSite,
      stored: {
        miles: Number(doc.milesFromHome),
        minutes: Number(doc.minutesOut),
        homeBy: backAt({ minutesOut: Number(doc.minutesOut), onSiteMinutes: onSite }),
      },
      routed: hit
        ? {
            miles: Math.round(hit.route.miles),
            minutes,
            homeBy: backAt({ minutesOut: minutes, onSiteMinutes: onSite }),
            duskOk: duskOk({ minutesOut: minutes, onSiteMinutes: onSite }),
            snapMiles: hit.route.snapMiles,
            lat: hit.lat,
            lng: hit.lng,
            what: hit.what,
            source: hit.source,
            at: hit.at,
          }
        : null,
      applied: Boolean(hit && doc.location && doc.travelFrom?.routedAt === hit.at),
    };
  });
}

/** Write routed travel for these ids (all located places when omitted). */
export async function applyTravel(db: Db, ids?: string[]): Promise<number> {
  const found = await loadLocations();
  const places = db.collection("places");
  const docs = await places
    .find(ids ? { id: { $in: ids } } : { id: { $in: Object.keys(found) } }, { projection: { embedding: 0 } })
    .toArray();
  const writes: AnyBulkWriteOperation<Document>[] = docs.flatMap((doc) => {
    const hit = found[String(doc.id)];
    if (!hit) return [];
    const minutes = hit.route.minutes;
    return [
      {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              location: { type: "Point", coordinates: [hit.lng, hit.lat] },
              locationWhat: hit.what,
              locationSource: hit.source,
              milesFromHome: Math.round(hit.route.miles),
              minutesOut: minutes,
              duskOk: duskOk({ minutesOut: minutes, onSiteMinutes: Number(doc.onSiteMinutes) }),
              travelFrom: { origin: APP_HOME, routedAt: hit.at },
              // Keep the first stored values, not the last applied ones.
              travelPrevious: doc.travelPrevious ?? { milesFromHome: doc.milesFromHome, minutesOut: doc.minutesOut },
            },
          },
        },
      },
    ];
  });
  if (!writes.length) return 0;
  return (await places.bulkWrite(writes)).modifiedCount;
}
