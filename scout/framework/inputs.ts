/**
 * Execution inputs are checked and normalized before an agent starts, so a bad input fails once,
 * up front, instead of every time a tool reads it. "place" inputs accept "lat,lng[,Label]", a
 * ZIP, a town, or an address, and are stored resolved ("lat,lng,Label") so the audit log shows
 * exactly where the run looked.
 */
import { geocode } from "../lib/geocode";
import { APP_HOME, parseOrigin } from "../lib/origin";
import type { AgentDefinition } from "./types";

const HOME_ZIP = "41144";
/** Whole counties and states are too coarse to search around. */
const TOO_COARSE = new Set(["county", "macrocounty", "region", "macroregion", "country"]);

export async function resolvePlace(text: string): Promise<string> {
  const value = text.trim();
  if (!value || value === HOME_ZIP || value.toLowerCase() === "home") return `${APP_HOME.lat},${APP_HOME.lng},${APP_HOME.label}`;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?/.test(value)) {
    const o = parseOrigin(value);
    return `${o.lat},${o.lng},${o.label}`;
  }
  const found = (await geocode(value, 5)).filter((p) => !TOO_COARSE.has(p.layer));
  const best = found[0];
  if (!best) throw new Error(`couldn't find "${value}"; try a town and state, a ZIP, or lat,lng`);
  return `${best.lat.toFixed(5)},${best.lng.toFixed(5)},${best.label.replace(/,/g, "")}`;
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
