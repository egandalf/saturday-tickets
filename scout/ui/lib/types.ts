/** Shapes the server hands to client components. Types only, so nothing server-side is bundled. */
import type { Leads, LocatedPin, PlaceDraft } from "../../framework/tools/outputs";
import type { AgentDefinition, AgentVersion, Decision, Execution, ExecutionEvent, InputField } from "../../framework/types";

export type { AgentDefinition, AgentVersion, Decision, Execution, ExecutionEvent, InputField, Leads, LocatedPin, PlaceDraft };
export type { TravelRow } from "../../lib/travel";

export type Stop = { kind: "select" | "approve" | "approve_tool"; summary: string; output?: unknown; error?: string | null; agent?: string; calls?: { id: string; name: string; input: unknown }[] };

export type ExecutionView = {
  execution: Execution;
  events: ExecutionEvent[];
  children: Execution[];
  parent: Execution | null;
  stop: Stop | null;
  result: unknown;
  stalled: boolean;
};

export type ToolInfo = {
  name: string;
  description: string;
  effect: "read" | "stage" | "write" | "output";
  review: string | null;
  onApprove: string | null;
  schema: Record<string, unknown>;
};

export const KIND_LIST = ["lake", "woods", "town", "history"] as const;

/**
 * Run-form field names get this prefix. A control named like a form property ("focus", "action",
 * "submit", "reset", "name") would shadow it: React calls form.focus() and gets the input instead.
 */
export const FIELD_PREFIX = "in:";

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

export function ago(date: string | Date): string {
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

/** Sonnet 5 list prices per million tokens; cache writes 1.25x input, reads 0.1x. */
export function costOf(usage: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const inRate = 2 / 1e6;
  const outRate = 10 / 1e6;
  return (
    (usage.input_tokens ?? 0) * inRate +
    (usage.cache_creation_input_tokens ?? 0) * inRate * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * inRate * 0.1 +
    (usage.output_tokens ?? 0) * outRate
  );
}
