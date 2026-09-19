/** The tool library. Agents pick from here by name; the UI lists it. */
import { z } from "zod";
import type { ToolDef } from "../types";
import { recall, remember } from "./memory";
import { parking_near, photo_search, photos_near, route_from_home } from "./open-data";
import { propose_leads, submit_location, submit_place_draft } from "./outputs";
import { apply_travel, known_places, promote_place } from "./places";
import { geocode, read_page, web_search } from "./web";

const all: ToolDef[] = [
  web_search,
  read_page,
  geocode,
  route_from_home,
  parking_near,
  photos_near,
  photo_search,
  known_places,
  recall,
  remember,
  propose_leads,
  submit_place_draft,
  submit_location,
  promote_place,
  apply_travel,
];

export const TOOLS: ReadonlyMap<string, ToolDef> = new Map(all.map((t) => [t.name, t]));

export function tool(name: string): ToolDef {
  const t = TOOLS.get(name);
  if (!t) throw new Error(`no tool "${name}" in the library`);
  return t;
}

/** JSON Schema for the Messages API: the zod schema as JSON Schema, minus the $schema key. */
export function inputSchema(t: ToolDef): Record<string, unknown> {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return schema;
}

/** For the UI's tool library page. */
export function describeTools() {
  return all.map((t) => ({
    name: t.name,
    description: t.description,
    effect: t.effect,
    review: t.review ?? null,
    onApprove: t.onApprove ?? null,
    schema: inputSchema(t),
  }));
}
