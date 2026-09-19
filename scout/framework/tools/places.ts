/** What's already known, and the two write tools that change live places (always gated by a person). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BaseStore } from "@langchain/langgraph";
import type { Db } from "mongodb";
import { z } from "zod";
import { signedTags } from "../../../lib/places";
import { straightMiles, type Run } from "../../lib/origin";
import { REPO_ROOT } from "../../lib/paths";
import { storePhoto, deletePhoto } from "../../lib/photos";
import { formatIssues, placeInput, WaterCrossingAssessment } from "../../lib/place-doc";
import { signTags } from "../../lib/sign-tags";
import { applyLocated } from "../../lib/travel";
import { upsertPlaces } from "../../lib/write-places";
import type { ToolDef } from "../types";
import { recallFrom, writeMemory } from "./memory";

export const KINDS = ["lake", "woods", "town", "history"] as const;
export type Kind = (typeof KINDS)[number];

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(state|resort|park|nature|preserve|snp|the|of|and|recreation|area|national|forest|historic|site)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Known = {
  places: { id: string; title: string; tags: string[] }[];
  counts: Record<Kind, number>;
  leads: { id: string; status: string; note: string }[];
  inFlight: { id: string; title: string; executionId: string }[];
};

export async function knownPlaces(db: Db, memory: BaseStore): Promise<Known> {
  const docs = await db.collection("places").find({}, { projection: { _id: 0, id: 1, title: 1 } }).toArray();
  const places = docs.map((d) => ({ id: String(d.id), title: String(d.title), tags: signedTags(String(d.id)) }));
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  for (const p of places) for (const t of p.tags) counts[t]++;
  const leads = (await recallFrom(memory, "lead", undefined, 500))
    .filter((m) => m.key === "status")
    .map((m) => ({ id: m.namespace.split("/")[1], status: String(m.status ?? ""), note: m.text }));
  const running = await db
    .collection("executions")
    .find({ agent: "research", status: { $in: ["queued", "running", "waiting"] } }, { projection: { _id: 1, input: 1 } })
    .toArray();
  const inFlight = running.map((e) => {
    const item = (e.input as { item?: { id?: string; title?: string } }).item ?? {};
    return { id: String(item.id), title: String(item.title), executionId: String(e._id) };
  });
  return { places, counts, leads, inFlight };
}

/** Why an id/title is already taken, or null. */
export function taken(known: Known, id: string, title: string): string | null {
  const norm = normalizeTitle(title);
  const place = known.places.find((p) => p.id === id || normalizeTitle(p.title) === norm);
  if (place) return `already a place (${place.id})`;
  const lead = known.leads.find((l) => l.id === id);
  if (lead) return `already a lead: ${lead.status} (${lead.note})`;
  const flight = known.inFlight.find((f) => f.id === id || normalizeTitle(f.title) === norm);
  if (flight) return `already being researched (${flight.executionId})`;
  return null;
}

export const known_places: ToolDef<Record<string, never>> = {
  name: "known_places",
  description:
    "Everything already known: places in the app with their signed tags and counts per kind, leads already rejected or promoted (with why), and leads being researched now. Check before proposing.",
  effect: "read",
  input: z.object({}),
  run: async (_input, ctx) => {
    const k = await knownPlaces(ctx.db, ctx.memory);
    return {
      counts: k.counts,
      places: k.places.map((p) => `${p.title} (${p.id}; ${p.tags.join(", ") || "untagged"})`),
      leads: k.leads.map((l) => `${l.id}: ${l.status} (${l.note})`),
      researchingNow: k.inFlight.map((f) => `${f.title} (${f.id})`),
    };
  },
};

const Point = z.object({ lat: z.number(), lng: z.number() });

export const DraftFields = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("kebab-case slug"),
  title: z.string().min(2),
  kinds: z.array(z.enum(KINDS)).min(1),
  summary: z.string().min(20).describe("What a family does there on a Saturday"),
  location: Point.describe("Where the family parks"),
  locationWhat: z.string().min(4).describe("The spot, e.g. 'beach lot off KY-1711'"),
  locationSource: z.string().min(4),
  surface: z.enum(["PAVED", "PACKED GRAVEL", "UNKNOWN"]),
  turnaround: z.enum(["yes", "no", "unknown"]),
  clayWhenWet: z.enum(["yes", "no", "unknown"]),
  waterCrossing: z.enum(["none", "established", "unknown"]),
  waterCrossingAssessment: WaterCrossingAssessment.nullable(),
  onSiteMinutes: z.number().int().min(30).max(480),
  seasonNote: z.string().nullable(),
  evidence: z.array(
    z.object({
      field: z.string(),
      source: z.string(),
      note: z.string(),
      confidence: z.enum(["confirmed", "inferred"]),
    }),
  ),
  concerns: z.array(z.string()),
  sources: z.array(z.url()).min(1),
  photos: z
    .array(z.object({ url: z.url(), pageUrl: z.string(), credit: z.string(), alt: z.string() }))
    .describe("Photo options from photos_near, best first; may be empty"),
});

export type DraftFields = z.infer<typeof DraftFields>;

const RunSchema = z.object({
  origin: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
  radiusMiles: z.number(),
});

const PromoteInput = z.object({
  draft: DraftFields,
  travel: z.object({ miles: z.number(), minutes: z.number().int() }),
  photo: z.object({ source: z.string().min(4), credit: z.string().min(2), alt: z.string().min(8) }),
  tags: z.array(z.enum(KINDS)).min(1),
  note: z.string().nullable(),
  run: RunSchema,
});

export type PromoteInput = z.infer<typeof PromoteInput>;

export const promote_place: ToolDef<PromoteInput> = {
  name: "promote_place",
  description:
    "Make an approved draft a live place: copy the photo to Blob at photos/<id>.jpg, embed and upsert into places, and add its tags to lib/places.ts for the person to commit.",
  effect: "write",
  input: PromoteInput,
  run: async ({ draft, travel, photo, tags, note, run }, ctx) => {
    const surface = draft.surface === "UNKNOWN" ? null : draft.surface;
    const record = (photoUrl: string) => ({
      id: draft.id,
      title: draft.title,
      surface,
      location: { type: "Point", coordinates: [draft.location.lng, draft.location.lat] },
      milesFromHome: Math.round(travel.miles),
      minutesOut: travel.minutes,
      onSiteMinutes: draft.onSiteMinutes,
      turnaround: draft.turnaround === "yes",
      waterCrossing: draft.waterCrossing === "established",
      ...(draft.waterCrossing === "established" && draft.waterCrossingAssessment
        ? { waterCrossingAssessment: draft.waterCrossingAssessment }
        : {}),
      clayWhenWet: draft.clayWhenWet !== "no",
      photo: photoUrl,
      photoAlt: photo.alt.trim(),
      credit: photo.credit.trim(),
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
    const schema = placeInput(run as Run);
    const dry = schema.safeParse(record("https://placeholder.invalid/photo.jpg"));
    if (!dry.success) throw new Error(formatIssues(dry.error).join("; "));

    const photoUrl = await storePhoto(draft.id, photo.source);
    const parsed = schema.safeParse(record(photoUrl));
    if (!parsed.success) {
      await deletePhoto(photoUrl);
      throw new Error(formatIssues(parsed.error).join("; "));
    }
    await upsertPlaces(ctx.db.collection("places"), [parsed.data], run as Run);
    const tagsAdded = await signTags([{ id: draft.id, tags }]);
    const { stdout: diff } = await promisify(execFile)("git", ["diff", "--", "lib/places.ts"], { cwd: REPO_ROOT });
    await writeMemory(ctx, `place/${draft.id}`, {
      key: "promoted",
      kind: "status",
      text: `Promoted to places: ${travel.miles} mi / ${travel.minutes} min from home, ${surface}, tags ${tags.join(", ")}.`,
      source: draft.locationSource,
    });
    await writeMemory(ctx, `lead/${draft.id}`, { key: "status", kind: "status", status: "promoted", text: "promoted to places" });
    return { placeId: draft.id, photoUrl, tagsAdded, diff };
  },
};

const ApplyTravelInput = z.object({
  placeId: z.string(),
  title: z.string(),
  lat: z.number(),
  lng: z.number(),
  what: z.string(),
  source: z.string(),
  route: z.looseObject({ miles: z.number(), minutes: z.number(), snapMiles: z.number() }),
});

export const apply_travel: ToolDef<z.infer<typeof ApplyTravelInput>> = {
  name: "apply_travel",
  description: "Write an approved pin and its routed drive to a live place (milesFromHome, minutesOut, location); keeps the old values as travelPrevious.",
  effect: "write",
  input: ApplyTravelInput,
  run: async (i, ctx) => {
    const at = new Date().toISOString();
    const { previous } = await applyLocated(ctx.db, {
      id: i.placeId,
      title: i.title,
      lat: i.lat,
      lng: i.lng,
      what: i.what,
      source: i.source,
      route: i.route as never,
      at,
    });
    await writeMemory(ctx, `place/${i.placeId}`, {
      key: "travel",
      kind: "travel",
      text: `Parks at ${i.what}; ${Math.round(i.route.miles)} mi / ${i.route.minutes} min from home (was ${previous.miles} mi / ${previous.minutes} min).`,
      source: i.source,
    });
    return { placeId: i.placeId, previous, now: { miles: Math.round(i.route.miles), minutes: i.route.minutes } };
  },
};

export function straightFrom(run: Run, at: { lat: number; lng: number }): number {
  return straightMiles(run.origin, at);
}
