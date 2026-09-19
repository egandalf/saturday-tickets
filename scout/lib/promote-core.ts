/**
 * Accepted candidate → place. Fields come from the candidate, then open data (the routed drive,
 * the mapped approach, parking), and a person answers only what neither settles. Shared by
 * scout:promote and the scout UI.
 */
import type { Db, Document } from "mongodb";
import type { CandidateDoc, KINDS } from "./candidate";
import { isError, routeFromHome, type RouteFacts } from "./enrich";
import { DEFAULT_RUN } from "./origin";
import { deletePhoto, storePhoto } from "./photos";
import { formatIssues, placeInput, type PlaceInput } from "./place-doc";
import { signTags } from "./sign-tags";
import { upsertPlaces } from "./write-places";

type Kind = (typeof KINDS)[number];
export type Surface = PlaceInput["surface"];

export type Field<T> = { value: T | null; why: string };

export type Draft = {
  surface: Field<Surface>;
  turnaround: Field<boolean>;
  clayWhenWet: Field<boolean>;
  /** null while a crossing is suspected: promote waits for a full waterCrossingAssessment. */
  waterCrossing: Field<false>;
  photo: { source: string; alt: string; credit: string } | null;
  route: RouteFacts;
};

/** What a person settles when the draft can't. */
export type Answers = {
  surface?: Surface;
  turnaround?: boolean;
  clayWhenWet?: boolean;
  photo?: { source: string; alt: string; credit: string };
};

export async function waiting(db: Db): Promise<CandidateDoc[]> {
  return (await db
    .collection<Document>("candidates")
    .find({ status: "accepted", promotedAt: { $exists: false } }, { projection: { _id: 0 } })
    .sort({ reviewedAt: 1 })
    .toArray()) as unknown as CandidateDoc[];
}

export async function draft(c: CandidateDoc): Promise<Draft> {
  const route = isError(c.enrichment.route) ? await routeFromHome(c.location) : c.enrichment.route;
  const lots = isError(c.enrichment.parking) ? 0 : c.enrichment.parking.lots.length;

  const surface: Field<Surface> =
    c.surface !== "UNKNOWN"
      ? { value: c.surface, why: "from the sources" }
      : route.suggestedSurface === "PAVED" || route.suggestedSurface === "PACKED GRAVEL"
        ? { value: route.suggestedSurface, why: "from the mapped approach" }
        : { value: null, why: `sources silent; mapped approach reads ${route.suggestedSurface}` };

  const turnaround: Field<boolean> =
    c.turnaround === "yes"
      ? { value: true, why: "from the sources" }
      : lots
        ? { value: true, why: `${lots} mapped parking lot(s) at the spot` }
        : { value: null, why: "sources silent and no parking mapped" };

  const clayWhenWet: Field<boolean> =
    c.clayWhenWet === "no"
      ? { value: false, why: "from the sources" }
      : surface.value === "PAVED" && route.approach.rough === 0
        ? { value: false, why: "paved approach, nothing rough mapped" }
        : { value: null, why: "unpaved or unmapped approach" };

  const waterCrossing: Field<false> =
    c.waterCrossing === "established" || route.fords.length
      ? { value: null, why: route.fords.length ? "the route crosses a ford" : "sources name an established crossing" }
      : { value: false, why: c.waterCrossing === "none" ? "from the sources" : "no ford on the routed approach" };

  const photo = c.photo ? { source: c.photo.url, alt: c.photo.description || c.photo.title, credit: c.photo.credit } : null;
  return { surface, turnaround, clayWhenWet, waterCrossing, photo, route };
}

/** Why this candidate can't become a place yet, after the answers; empty when it can. */
export function blockers(d: Draft, a: Answers = {}): string[] {
  const out: string[] = [];
  if (d.waterCrossing.value === null) out.push(`${d.waterCrossing.why}: needs a waterCrossingAssessment`);
  if ((a.surface ?? d.surface.value) === null) out.push("surface to parking");
  const turnaround = a.turnaround ?? d.turnaround.value;
  if (turnaround === null) out.push("turnaround");
  else if (!turnaround) out.push("no turnaround: not a fit");
  const clay = a.clayWhenWet ?? d.clayWhenWet.value;
  if (clay === null) out.push("clay when wet");
  else if (clay) out.push("clay when wet: not a fit");
  const photo = a.photo ?? d.photo;
  if (!photo?.source || !photo.alt?.trim() || !photo.credit?.trim()) out.push("photo, alt text, and credit");
  return out;
}

function toPlace(c: CandidateDoc, d: Draft, a: Answers, photoUrl: string): Record<string, unknown> {
  const photo = a.photo ?? d.photo;
  return {
    id: c.id,
    title: c.title,
    surface: a.surface ?? d.surface.value,
    location: { type: "Point", coordinates: [c.location.lng, c.location.lat] },
    milesFromHome: Math.round(d.route.miles),
    minutesOut: d.route.minutes,
    onSiteMinutes: c.onSiteMinutes,
    turnaround: a.turnaround ?? d.turnaround.value,
    waterCrossing: d.waterCrossing.value,
    clayWhenWet: a.clayWhenWet ?? d.clayWhenWet.value,
    photo: photoUrl,
    photoAlt: photo?.alt.trim(),
    credit: photo?.credit.trim(),
    ...(c.reviewNote ? { note: c.reviewNote } : {}),
  };
}

export type Promoted = { place: PlaceInput; photoUrl: string; tagsAdded: Record<string, string[]> };

/** Validate, copy the photo to Blob, embed and upsert, mark the candidate, sign its tags. */
export async function promote(db: Db, c: CandidateDoc, d: Draft, a: Answers): Promise<Promoted> {
  const blocked = blockers(d, a);
  if (blocked.length) throw new Error(`still needed: ${blocked.join("; ")}`);
  const run = c.scoutedFrom ?? DEFAULT_RUN;
  const schema = placeInput(run);
  const dry = schema.safeParse(toPlace(c, d, a, "https://placeholder.invalid/photo.jpg"));
  if (!dry.success) throw new Error(formatIssues(dry.error).join("; "));

  const photoUrl = await storePhoto(c.id, (a.photo ?? d.photo)!.source);
  const parsed = schema.safeParse(toPlace(c, d, a, photoUrl));
  if (!parsed.success) {
    await deletePhoto(photoUrl);
    throw new Error(formatIssues(parsed.error).join("; "));
  }
  await upsertPlaces(db.collection("places"), [parsed.data], run);
  await db.collection("candidates").updateOne({ id: c.id }, { $set: { promotedAt: new Date(), photoUrl } });
  const tagsAdded = await signTags([{ id: c.id, tags: (c.tags ?? []) as Kind[] }]);
  return { place: parsed.data, photoUrl, tagsAdded };
}
