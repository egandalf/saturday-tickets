/** Shapes the server hands to client components. Types only, so nothing server-side is bundled. */
import type { ReviewRequest } from "../../graph";
import type { CandidateDoc, Decision } from "../../lib/candidate";
import type { Answers, Draft } from "../../lib/promote-core";
import type { EventDoc, RunDoc } from "../../lib/runs";

export type { Answers, CandidateDoc, Decision, Draft, EventDoc, ReviewRequest, RunDoc };
export type { TravelRow } from "../../lib/travel";

export type CardData = { request: ReviewRequest; summary: string; flags: string[] };

export type RunView = { run: RunDoc; events: EventDoc[]; cards: CardData[] };

export type PromoteItem = { candidate: CandidateDoc; draft: Draft; blockers: string[]; flags: string[] };

export const KIND_LIST = ["lake", "woods", "town", "history"] as const;

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

export function mapEmbed(lat: number, lng: number, span = 0.012): string {
  const bbox = [lng - span * 1.6, lat - span, lng + span * 1.6, lat + span].map((n) => n.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}
