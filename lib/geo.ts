/**
 * Where a deal starts from. Home (41144 Greenup, KY) is the default; a family can deal from a
 * typed place or the device's location. Shared with scout, which geocodes the same way.
 */
import tzlookup from "tz-lookup";
import { log } from "./log";

export type Point = { lat: number; lng: number };
export type Origin = Point & { label: string; tz: string };

export const HOME: Origin = { label: "41144 Greenup, KY", lat: 38.578, lng: -82.83, tz: "America/New_York" };
export const DEFAULT_RADIUS_MILES = 150;
export const RADIUS_CHOICES = [60, 90, 150, 200] as const;

/** Great-circle miles. Road miles can only be longer. */
export function straightMiles(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function isHome(o: Point): boolean {
  return straightMiles(o, HOME) < 1;
}

export function originAt(lat: number, lng: number, label: string): Origin {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`not a point: ${lat},${lng}`);
  }
  const point = { lat, lng };
  if (isHome(point)) return HOME;
  return { label: label.trim() || `${lat.toFixed(3)},${lng.toFixed(3)}`, lat, lng, tz: tzlookup(lat, lng) };
}

/** "lat,lng,Label" (the API and cookie form) → Origin, or null when missing or malformed. */
export function parseOrigin(text: string | null | undefined): Origin | null {
  if (!text?.trim()) return null;
  const [lat, lng, ...rest] = text.split(",");
  try {
    return originAt(Number(lat), Number(lng), rest.join(",").trim());
  } catch {
    return null;
  }
}

/** The label may contain commas; parseOrigin rejoins everything after lat,lng. */
export function formatOrigin(o: Origin): string {
  return `${o.lat},${o.lng},${o.label}`;
}

export function parseRadius(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 5 && n <= 500 ? n : DEFAULT_RADIUS_MILES;
}

type Feature = { geometry: { coordinates: [number, number] }; properties: { label: string; layer: string; name?: string; region_a?: string; locality?: string; county?: string } };

async function ors(path: string, params: Record<string, string>): Promise<Feature[]> {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) throw new Error("ORS_API_KEY unset");
  const res = await fetch(`https://api.openrouteservice.org${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ors ${path} ${res.status}`);
  return ((await res.json()) as { features?: Feature[] }).features ?? [];
}

/** Whole counties and states are too coarse to deal from. */
const TOO_COARSE = new Set(["county", "macrocounty", "region", "macroregion", "country"]);

export type Found = Point & { label: string; layer: string };

const UA = "saturday-tickets/0.1 (https://github.com/egandalf/saturday-tickets)";

function fromFeatures(features: Feature[]): Found[] {
  return features.map((f) => ({ label: f.properties.label, layer: f.properties.layer, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}

/** OpenStreetMap's own geocoder; the last resort (its policy: low volume, identified). */
async function nominatim(text: string, size: number): Promise<Found[]> {
  const params = new URLSearchParams({ q: text, format: "jsonv2", countrycodes: "us", limit: String(size) });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string; addresstype?: string }[];
  const layer = (t?: string) => (t === "county" ? "county" : t === "state" ? "region" : t === "postcode" ? "postalcode" : t === "city" || t === "town" || t === "village" || t === "hamlet" ? "locality" : t ?? "venue");
  return rows.map((r) => ({ label: r.display_name.replace(/, United States$/, ""), layer: layer(r.addresstype), lat: Number(r.lat), lng: Number(r.lon) }));
}

/**
 * Forward geocoding with fallbacks, so a spent daily quota doesn't break typing a place:
 * ORS search, then ORS autocomplete (its own quota), then Nominatim.
 */
export async function geocode(text: string, size = 5): Promise<Found[]> {
  const attempts: [string, () => Promise<Found[]>][] = [
    ["ors search", async () => fromFeatures(await ors("/geocode/search", { text, "boundary.country": "US", size: String(size) }))],
    ["ors autocomplete", async () => fromFeatures(await ors("/geocode/autocomplete", { text, "boundary.country": "US", size: String(size) }))],
    ["nominatim", () => nominatim(text, size)],
  ];
  const failures: string[] = [];
  for (const [name, attempt] of attempts) {
    try {
      const found = await attempt();
      if (failures.length) log.line("origin.geocode.fallback", { used: name, failed: failures });
      return found;
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(`geocoding unavailable (${failures.join("; ")})`);
}

/** A typed ZIP, town, or address → Origin. The home ZIP maps to home exactly. */
export async function originFromText(text: string): Promise<Origin> {
  const value = text.trim();
  if (!value || value === "41144" || value.toLowerCase() === "home") return HOME;
  const coords = value.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(.+))?$/);
  if (coords) return originAt(Number(coords[1]), Number(coords[2]), coords[3] ?? "");
  const best = (await geocode(value)).find((p) => !TOO_COARSE.has(p.layer));
  if (!best) throw new Error(`couldn't find "${value}"; try a town and state, a ZIP, or an address`);
  log.line("origin.geocode", { text: value, label: best.label, layer: best.layer });
  return originAt(best.lat, best.lng, best.label.replace(/, USA$/, ""));
}

/** The device's location → Origin labelled with the nearest town ("Near Winchester, KY"). */
export async function originFromPoint(lat: number, lng: number): Promise<Origin> {
  let label = "My location";
  try {
    const [near] = await ors("/geocode/reverse", { "point.lat": String(lat), "point.lon": String(lng), size: "1", layers: "locality,localadmin,neighbourhood" });
    const p = near?.properties;
    const town = p?.locality ?? p?.name;
    if (town) label = `Near ${town}${p?.region_a ? `, ${p.region_a}` : ""}`;
  } catch (err) {
    log.error("origin.reverse.fail", err);
  }
  return originAt(lat, lng, label);
}
