/**
 * Output tools end an agent's work and shape its HITL stop. Each can refuse (final: false) with
 * a reason the agent can act on (a duplicate, a flag to research), so what reaches a person is
 * the agent's best work, not its first draft.
 */
import { z } from "zod";
import { describe, enrich, isError, routeFromHome, type Enrichment, type RouteFacts } from "../../lib/enrich";
import { APP_HOME, APP_RADIUS_MILES, parseOrigin, parseRadius, straightMiles, type Run } from "../../lib/origin";
import type { OutputResult, ToolDef } from "../types";
import { writeMemory } from "./memory";
import { DraftFields, KINDS, knownPlaces, taken, type DraftFields as Draft } from "./places";

/** The search area for a run: from its own input, or its parent's for handoffs. */
export function runOf(input: Record<string, unknown>): Run {
  const parent = (input.parent as { input?: Record<string, unknown> } | undefined)?.input;
  const src = (parent ?? input) as { origin?: unknown; radius?: unknown };
  const origin = typeof src.origin === "string" && src.origin.trim() ? parseOrigin(src.origin) : APP_HOME;
  const radiusMiles = src.radius !== undefined && src.radius !== "" ? parseRadius(String(src.radius)) : APP_RADIUS_MILES;
  return { origin, radiusMiles };
}

const Lead = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("kebab-case slug"),
  title: z.string().min(2),
  kinds: z.array(z.enum(KINDS)).min(1),
  why: z.string().min(10).describe("Why a family would go, one or two sentences"),
  where: z.string().min(2).describe("Town and state"),
  approxLocation: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  sources: z.array(z.url()).min(1),
});

export type Lead = z.infer<typeof Lead>;
export type Leads = { leads: Lead[]; dropped: { id: string; why: string }[] };

export const propose_leads: ToolDef<{ leads: Lead[] }, OutputResult<Leads>> = {
  name: "propose_leads",
  description:
    "Finish by proposing leads for a person to choose from. Duplicates of known places or leads, and leads outside the search radius, are dropped and reported back.",
  effect: "output",
  review: "select",
  summarize: (o: Leads) => `${o.leads.length} lead(s) to choose from`,
  items: (o: Leads) => o.leads.map((l) => ({ id: l.id, title: l.title, value: l })),
  input: z.object({ leads: z.array(Lead).min(1) }),
  run: async ({ leads }, ctx) => {
    const known = await knownPlaces(ctx.db, ctx.memory);
    const run = runOf(ctx.input);
    const dropped: Leads["dropped"] = [];
    const fresh = leads.filter((l) => {
      const why =
        taken(known, l.id, l.title) ??
        (l.approxLocation && straightMiles(run.origin, l.approxLocation) > run.radiusMiles
          ? `${straightMiles(run.origin, l.approxLocation).toFixed(0)} mi from ${run.origin.label}, outside ${run.radiusMiles} mi`
          : null);
      if (why) dropped.push({ id: l.id, why });
      return !why;
    });
    if (!fresh.length) {
      return { final: false, message: `None kept: ${dropped.map((d) => `${d.id} (${d.why})`).join("; ")}. Find different places.` };
    }
    return {
      final: true,
      output: { leads: fresh, dropped },
      message: `Proposed ${fresh.length} lead(s) for review${dropped.length ? `; dropped ${dropped.map((d) => `${d.id} (${d.why})`).join("; ")}` : ""}.`,
    };
  },
};

export type PlaceDraft = { draft: Draft; enrichment: Enrichment; flags: string[]; run: Run };

export const submit_place_draft: ToolDef<Draft & { acknowledgeFlags?: boolean }, OutputResult<PlaceDraft>> = {
  name: "submit_place_draft",
  description:
    "Finish by submitting the researched place for the family to approve. It routes the drive from home, checks the approach, parking, and photos, and returns flags; research a flag and resubmit, or resubmit with acknowledgeFlags: true to hand it over as is. An established water crossing needs a full waterCrossingAssessment.",
  effect: "output",
  review: "approve",
  onApprove: "promote_place",
  summarize: (o: PlaceDraft) => `approve ${o.draft.title}`,
  onReject: async (o: PlaceDraft, reason, ctx) => {
    await writeMemory(ctx, `lead/${o.draft.id}`, { key: "status", kind: "status", status: "rejected", text: reason });
  },
  input: DraftFields.extend({ acknowledgeFlags: z.boolean().optional() }).superRefine((d, ctx) => {
    if (d.waterCrossing === "established" && !d.waterCrossingAssessment) {
      ctx.addIssue({ code: "custom", path: ["waterCrossingAssessment"], message: "an established crossing needs a full assessment" });
    }
  }),
  run: async ({ acknowledgeFlags, ...draft }, ctx) => {
    const known = await knownPlaces(ctx.db, ctx.memory);
    const place = known.places.find((p) => p.id === draft.id);
    if (place) return { final: false, message: `${draft.id} is already a place. Stop and say so.` };
    const run = runOf(ctx.input);
    const fromOrigin = straightMiles(run.origin, draft.location);
    if (fromOrigin > run.radiusMiles) {
      return { final: false, message: `${fromOrigin.toFixed(0)} mi from ${run.origin.label}, outside the ${run.radiusMiles} mi search radius.` };
    }

    const enrichment = await enrich(draft.location);
    const { summary, flags } = describe(enrichment);
    const route = enrichment.route;
    if (!isError(route)) {
      if (draft.surface !== "UNKNOWN" && route.suggestedSurface !== "UNKNOWN" && route.suggestedSurface !== draft.surface) {
        flags.push(`you said ${draft.surface}; the mapped approach reads ${route.suggestedSurface}`);
      }
      if (route.fords.length && draft.waterCrossing === "none") flags.push("you said no water crossing, but the route crosses a ford");
    }
    if (draft.turnaround === "no") flags.push("no turnaround: not a fit");
    if (draft.clayWhenWet === "yes") flags.push("clay when wet: not a fit");
    if (!draft.photos.length && (isError(enrichment.photos) || !enrichment.photos.length)) flags.push("no photo options");

    if (flags.length && !acknowledgeFlags) {
      return {
        final: false,
        message: `${summary}\nFlags:\n- ${flags.join("\n- ")}\nResearch what the pages can settle and resubmit, or resubmit with acknowledgeFlags: true.`,
      };
    }
    return { final: true, output: { draft, enrichment, flags, run }, message: `Submitted for review. ${summary}` };
  },
};

export type LocatedPin = {
  placeId: string;
  title: string;
  lat: number;
  lng: number;
  what: string;
  source: string;
  confidence: "confirmed" | "inferred";
  route: RouteFacts;
  stored: { miles: number; minutes: number };
};

export const submit_location: ToolDef<
  { lat: number; lng: number; what: string; source: string; confidence: "confirmed" | "inferred"; acknowledgeFlags?: boolean },
  OutputResult<LocatedPin>
> = {
  name: "submit_location",
  description:
    "Finish by submitting where the family parks for this place. It routes the drive from home and flags a pin far from a road; refine and resubmit, or acknowledge the flag.",
  effect: "output",
  review: "approve",
  onApprove: "apply_travel",
  summarize: (o: LocatedPin) => `approve the pin for ${o.title}`,
  onReject: async (o: LocatedPin, reason, ctx) => {
    await writeMemory(ctx, `place/${o.placeId}`, { kind: "rejected-pin", text: `Pin at ${o.what} (${o.lat}, ${o.lng}) rejected: ${reason}`, source: o.source });
  },
  input: z.object({
    lat: z.number(),
    lng: z.number(),
    what: z.string().min(4),
    source: z.string().min(4),
    confidence: z.enum(["confirmed", "inferred"]),
    acknowledgeFlags: z.boolean().optional(),
  }),
  run: async ({ acknowledgeFlags, ...pin }, ctx) => {
    const placeId = String(ctx.input.placeId ?? "");
    const doc = await ctx.db.collection("places").findOne({ id: placeId }, { projection: { embedding: 0 } });
    if (!doc) return { final: false, message: `No place ${placeId}.` };
    const route = await routeFromHome(pin);
    if (route.snapMiles > 0.25 && !acknowledgeFlags) {
      return {
        final: false,
        message: `The pin is ${route.snapMiles} mi from the nearest road (drive ${route.miles} mi, ${route.minutes} min). Move it to the lot or entrance, or resubmit with acknowledgeFlags: true.`,
      };
    }
    return {
      final: true,
      output: {
        placeId,
        title: String(doc.title),
        ...pin,
        route,
        stored: { miles: Number(doc.milesFromHome), minutes: Number(doc.minutesOut) },
      },
      message: `Submitted: ${route.miles} mi, ${route.minutes} min from home (on file ${doc.milesFromHome} mi, ${doc.minutesOut} min).`,
    };
  },
};

export const HOME = APP_HOME;
