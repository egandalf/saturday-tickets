/**
 * What the discover agent can establish from the web. Unknowns stay unknown; review and the
 * enrich step (drive times, surface from OpenStreetMap, photos) fill the rest before promote.
 */
import { z } from "zod";
import type { Enrichment, Photo } from "./enrich";
import type { Run } from "./origin";

export const KINDS = ["lake", "woods", "town", "history"] as const;

export const Candidate = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("kebab-case slug, e.g. carter-caves"),
    title: z.string().min(2).describe("Short name as a family would say it"),
    kinds: z.array(z.enum(KINDS)).min(1).describe("Suggested kinds; a person signs the final tags"),
    summary: z.string().min(20).describe("What a family does there on a Saturday, 1-3 sentences"),
    location: z
      .object({ lat: z.number(), lng: z.number() })
      .describe("Coordinates of the destination parking or entrance, copied from a source page"),
    locationSource: z.string().min(8).describe("URL or page the coordinates came from"),
    address: z.string().nullable(),
    surface: z.enum(["PAVED", "PACKED GRAVEL", "UNKNOWN"]).describe("Road surface all the way to parking"),
    turnaround: z.enum(["yes", "no", "unknown"]).describe("Room to turn a full-size vehicle around at the end"),
    waterCrossing: z
      .enum(["none", "established", "unknown"])
      .describe("Any ford or low-water crossing on the way in. Established = maintained, signed, public road"),
    waterCrossingNotes: z
      .string()
      .nullable()
      .describe("Required when established: waterway, where on the route, depth, when it closes, bypass"),
    clayWhenWet: z.enum(["yes", "no", "unknown"]).describe("Unpaved clay that turns slick after rain"),
    onSiteMinutes: z.number().int().min(30).max(480).describe("Typical family visit length"),
    seasonNote: z.string().nullable().describe("Seasonal closures, hours, gates, fees"),
    concerns: z.array(z.string()).describe("Anything a parent should know before accepting"),
    sources: z.array(z.url()).min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.waterCrossing === "established" && !c.waterCrossingNotes?.trim()) {
      ctx.addIssue({ code: "custom", path: ["waterCrossingNotes"], message: "established crossing needs notes" });
    }
  });

export type Candidate = z.infer<typeof Candidate>;

/** A submitted candidate plus what open data says about getting there. */
export type Scouted = Candidate & { enrichment: Enrichment };

export type Decision =
  | { id: string; decision: "accept"; tags: (typeof KINDS)[number][]; note: string | null; photo: number | null }
  | { id: string; decision: "reject"; reason: string }
  | { id: string; decision: "skip" };

/** The `candidates` collection document. Rejected ones stay so later runs don't suggest them again. */
export type CandidateDoc = Scouted & {
  status: "accepted" | "rejected";
  tags?: (typeof KINDS)[number][];
  photo?: Photo | null;
  reviewNote?: string | null;
  rejectReason?: string;
  scoutedFrom: Run;
  threadId: string;
  reviewedAt: Date;
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(state|resort|park|nature|preserve|snp|the|of|and|recreation|area|national|forest)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
