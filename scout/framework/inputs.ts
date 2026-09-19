/**
 * Execution inputs are checked and normalized before an agent starts, so a bad input fails once,
 * up front, instead of every time a tool reads it. "place" inputs accept "lat,lng[,Label]", a
 * ZIP, a town, or an address, and are stored resolved ("lat,lng,Label") so the audit log shows
 * exactly where the run looked.
 */
import { formatOrigin, originFromText } from "../../lib/geo";
import type { AgentDefinition } from "./types";

/** A ZIP, town, address, or lat,lng → "lat,lng,Label"; the home ZIP is home exactly (same resolver as the app). */
export async function resolvePlace(text: string): Promise<string> {
  return formatOrigin(await originFromText(text));
}

/** Defaults, required fields, types; place fields geocoded. Throws with the field name. */
export async function checkInput(def: AgentDefinition, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const f of def.input) {
    let v = input[f.name];
    const empty = (x: unknown) => x === undefined || x === null || (typeof x === "string" && !x.trim());
    if (empty(v) && f.default !== undefined) v = f.default;
    if (empty(v) && f.required) throw new Error(`${f.label || f.name} is required`);
    if (empty(v)) continue;
    try {
      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error("must be a number");
        v = n;
      } else if (f.type === "json" && typeof v === "string") {
        v = JSON.parse(v);
      } else if (f.type === "place") {
        v = await resolvePlace(String(v));
      }
    } catch (err) {
      throw new Error(`${f.label || f.name}: ${err instanceof Error ? err.message : err}`);
    }
    out[f.name] = v;
  }
  return out;
}
