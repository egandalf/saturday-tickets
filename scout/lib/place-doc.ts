/** The Atlas `places` document as scout writes it. Hard filters are refused here, not stored as badges. */
import { z } from "zod";
import { saturdaySunset } from "../../lib/sun";

export const HOME = "41144 Greenup, Kentucky";
export const MAX_MILES = 150;
export const SATURDAY_START = 10 * 60;
export const EMBED_MODEL = "voyage-3-lite";
export const EMBED_DIMS = 512;

export const PlaceInput = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be a kebab-case slug"),
    title: z.string().trim().min(2),
    surface: z.enum(["PAVED", "PACKED GRAVEL"]),
    milesFromHome: z.number().int().positive().max(MAX_MILES, `more than ${MAX_MILES} miles from ${HOME}`),
    minutesOut: z.number().int().positive(),
    onSiteMinutes: z.number().int().positive(),
    turnaround: z.boolean(),
    waterCrossing: z.boolean(),
    clayWhenWet: z.boolean(),
    photo: z.url({ protocol: /^https$/ }),
    photoAlt: z.string().trim().min(8),
    credit: z.string().trim().min(2),
    note: z.string().trim().min(2).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!p.turnaround) ctx.addIssue({ code: "custom", path: ["turnaround"], message: "no turnaround" });
    if (p.waterCrossing) ctx.addIssue({ code: "custom", path: ["waterCrossing"], message: "water crossing" });
    if (p.clayWhenWet) ctx.addIssue({ code: "custom", path: ["clayWhenWet"], message: "clay when wet" });
    const back = backAt(p);
    const dusk = longestSaturday();
    if (back > dusk.minutes) {
      ctx.addIssue({
        code: "custom",
        path: ["minutesOut"],
        message: `back at ${back} min after midnight, after dusk even on ${dusk.date} (${dusk.clock})`,
      });
    }
  });

export type PlaceInput = z.infer<typeof PlaceInput>;

export type PlaceDoc = PlaceInput & {
  duskOk: true;
  embedding: number[];
  embeddingModel: typeof EMBED_MODEL;
  embeddingDims: number;
};

/** Minutes after midnight the family is home, leaving at 10:00. Same math as the deal filter. */
export function backAt(p: Pick<PlaceInput, "minutesOut" | "onSiteMinutes">): number {
  return SATURDAY_START + p.minutesOut + p.onSiteMinutes + p.minutesOut;
}

let longest: ReturnType<typeof saturdaySunset> | undefined;

/**
 * duskOk means back before dusk on at least one Saturday of the year. The live deal still
 * checks the coming Saturday, so winter drops the long drives (Jenny Wiley, Ash Cave, Natural Bridge).
 */
export function longestSaturday(): ReturnType<typeof saturdaySunset> {
  if (!longest) {
    const start = Date.now();
    for (let week = 0; week < 53; week++) {
      const sat = saturdaySunset(new Date(start + week * 7 * 86_400_000));
      if (!longest || sat.minutes > longest.minutes) longest = sat;
    }
  }
  return longest!;
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
