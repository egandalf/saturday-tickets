/** The Atlas `places` document as scout writes it. Hard filters are refused here, not stored as badges. */
import { z } from "zod";
import { saturdaySunset, type SaturdaySunset } from "../../lib/sun";
import { straightMiles, type Origin, type Run } from "./origin";

export const SATURDAY_START = 10 * 60;
export const EMBED_MODEL = "voyage-3-lite";
export const EMBED_DIMS = 512;

/** GeoJSON order is [lng, lat]. */
const GeoPoint = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});

export type GeoPoint = z.infer<typeof GeoPoint>;

export function latLng(point: GeoPoint): { lat: number; lng: number } {
  return { lat: point.coordinates[1], lng: point.coordinates[0] };
}

/**
 * Established crossings only, and only with the homework done: where it is, how deep it runs,
 * when it closes, a way around, and sources. Review reads this before a place is accepted.
 */
export const WaterCrossingAssessment = z
  .object({
    kind: z.enum(["low-water bridge", "concrete ford", "paved dip", "gravel ford"]),
    established: z.literal(true, "only established, maintained crossings"),
    waterway: z.string().trim().min(2),
    location: GeoPoint,
    where: z.string().trim().min(8),
    typicalDepthInches: z.number().min(0).max(24),
    closesWhen: z.string().trim().min(8),
    bypass: z.string().trim().min(4).nullable(),
    usgsGauge: z.string().regex(/^\d{8,15}$/, "USGS site number").nullable(),
    risks: z.array(z.string().trim().min(4)).min(1),
    sources: z.array(z.url({ protocol: /^https?$/ })).min(1),
    assessedAt: z.iso.date(),
  })
  .strict();

export type WaterCrossingAssessment = z.infer<typeof WaterCrossingAssessment>;

const PlaceFields = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be a kebab-case slug"),
    title: z.string().trim().min(2),
    surface: z.enum(["PAVED", "PACKED GRAVEL"]),
    location: GeoPoint,
    milesFromHome: z.number().int().positive(),
    minutesOut: z.number().int().positive(),
    onSiteMinutes: z.number().int().positive(),
    turnaround: z.boolean(),
    waterCrossing: z.boolean(),
    waterCrossingAssessment: WaterCrossingAssessment.optional(),
    clayWhenWet: z.boolean(),
    photo: z.url({ protocol: /^https$/ }),
    photoAlt: z.string().trim().min(8),
    credit: z.string().trim().min(2),
    note: z.string().trim().min(2).optional(),
  })
  .strict();

export type PlaceInput = z.infer<typeof PlaceFields>;

/** milesFromHome and minutesOut are measured from the run's origin. */
export function placeInput(run: Run) {
  return PlaceFields.superRefine((p, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (!p.turnaround) issue("turnaround", "no turnaround");
    if (p.clayWhenWet) issue("clayWhenWet", "clay when wet");
    if (p.waterCrossing && !p.waterCrossingAssessment) {
      issue("waterCrossingAssessment", "water crossing needs an assessment before it can be accepted");
    }
    if (!p.waterCrossing && p.waterCrossingAssessment) {
      issue("waterCrossing", "has an assessment but waterCrossing is false");
    }

    if (p.milesFromHome > run.radiusMiles) {
      issue("milesFromHome", `${p.milesFromHome} mi is past the ${run.radiusMiles} mi radius from ${run.origin.label}`);
    }
    const straight = straightMiles(run.origin, latLng(p.location));
    if (p.milesFromHome < straight - 1) {
      issue(
        "milesFromHome",
        `${p.milesFromHome} road miles is shorter than the ${straight.toFixed(0)} straight-line miles from ${run.origin.label}`,
      );
    }

    const dusk = longestSaturday(run.origin);
    if (backAt(p) > dusk.minutes) {
      issue("minutesOut", `home after dusk even on the longest Saturday (${dusk.date}, ${dusk.clock})`);
    }
  });
}

export type PlaceDoc = PlaceInput & {
  duskOk: true;
  measuredFrom: Origin;
  embedding: number[];
  embeddingModel: typeof EMBED_MODEL;
  embeddingDims: number;
};

/** Minutes after midnight the family is home, leaving at 10:00. Same math as the deal filter. */
export function backAt(p: Pick<PlaceInput, "minutesOut" | "onSiteMinutes">): number {
  return SATURDAY_START + p.minutesOut + p.onSiteMinutes + p.minutesOut;
}

const longest = new Map<string, SaturdaySunset>();

/**
 * duskOk means back before dusk on at least one Saturday of the year. The live deal still
 * checks the coming Saturday, so winter drops the long drives (Jenny Wiley, Ash Cave, Natural Bridge).
 */
export function longestSaturday(origin: Origin): SaturdaySunset {
  const key = `${origin.lat},${origin.lng}`;
  let best = longest.get(key);
  if (!best) {
    const start = Date.now();
    for (let week = 0; week < 53; week++) {
      const sat = saturdaySunset(new Date(start + week * 7 * 86_400_000), origin);
      if (!best || sat.minutes > best.minutes) best = sat;
    }
    longest.set(key, best!);
  }
  return best!;
}

/**
 * Text that gets embedded for a place. The original 22 were embedded outside this repo; this
 * format scored ~0.94 cosine against their stored vectors, the closest of the formats tried.
 */
export function embedText(p: PlaceInput): string {
  return [
    p.title,
    p.photoAlt,
    p.note,
    p.surface,
    `${p.milesFromHome} miles, ${p.minutesOut} min drive, ${p.onSiteMinutes} min on site`,
  ]
    .filter(Boolean)
    .join(". ");
}

export function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((issue) => `${issue.path.join(".") || "(place)"}: ${issue.message}`);
}
