/**
 * Drive times from where the deal starts. Home uses each place's stored miles and minutes, as
 * before. Anywhere else: places with a location inside the radius as the crow flies, then the
 * Atlas cache, then one OpenRouteService matrix call for the rest. If ORS is down, an estimate
 * (straight line × road factor at an average speed), which the ticket labels "est.".
 */
import { isHome, straightMiles, type Origin, type Point } from "./geo";
import { log } from "./log";
import { readTravelCache, writeTravelCache } from "./mongo";
import type { Place } from "./places";

export type Travel = { miles: number; minutes: number; source: "stored" | "cache" | "route" | "estimate" };

const ROAD_FACTOR = 1.3;
const ESTIMATE_MPH = 45;
const MAX_DESTINATIONS = 3000;

/** ~100 m: nearby starting points share cached routes. */
function originKey(o: Point): string {
  return `${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;
}

function estimate(from: Point, to: Point): Travel {
  const miles = straightMiles(from, to) * ROAD_FACTOR;
  return { miles: Math.round(miles * 10) / 10, minutes: Math.ceil((miles / ESTIMATE_MPH) * 60), source: "estimate" };
}

async function matrix(origin: Point, destinations: Point[]): Promise<({ miles: number; minutes: number } | null)[]> {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) throw new Error("ORS_API_KEY unset");
  const res = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [[origin.lng, origin.lat], ...destinations.map((d) => [d.lng, d.lat])],
      sources: [0],
      destinations: destinations.map((_, i) => i + 1),
      metrics: ["duration", "distance"],
      units: "mi",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ors matrix ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { durations?: (number | null)[][]; distances?: (number | null)[][] };
  const seconds = data.durations?.[0] ?? [];
  const miles = data.distances?.[0] ?? [];
  return destinations.map((_, i) => {
    const s = seconds[i];
    const m = miles[i];
    return typeof s === "number" && typeof m === "number" ? { miles: Math.round(m * 10) / 10, minutes: Math.ceil(s / 60) } : null;
  });
}

export async function travelFrom(
  origin: Origin,
  places: Place[],
  radiusMiles: number,
): Promise<{ travel: Map<string, Travel>; skipped: { id: string; reason: string }[] }> {
  const travel = new Map<string, Travel>();
  const skipped: { id: string; reason: string }[] = [];

  if (isHome(origin)) {
    for (const p of places) travel.set(p.id, { miles: p.milesFromHome, minutes: p.minutesOut, source: "stored" });
    log.line("travel.home", { count: places.length, source: "stored" });
    return { travel, skipped };
  }

  const routable: (Place & { location: Point })[] = [];
  for (const p of places) {
    if (!p.location) {
      skipped.push({ id: p.id, reason: "no location yet (locate it in scout)" });
      continue;
    }
    const straight = straightMiles(origin, p.location);
    if (straight > radiusMiles) skipped.push({ id: p.id, reason: `${Math.round(straight)} mi as the crow flies` });
    else routable.push(p as Place & { location: Point });
  }

  const key = originKey(origin);
  const cached = await readTravelCache(routable.map((p) => `${key}:${p.id}`)).catch((err) => {
    log.error("travel.cache.fail", err);
    return [];
  });
  const hits = new Map(cached.map((c) => [c._id.slice(key.length + 1), c]));
  for (const [id, c] of hits) travel.set(id, { miles: c.miles, minutes: c.minutes, source: "cache" });

  const need = routable.filter((p) => !hits.has(p.id)).slice(0, MAX_DESTINATIONS);
  let routed = 0;
  let estimated = 0;
  if (need.length) {
    const started = Date.now();
    try {
      const rows = await matrix(origin, need.map((p) => p.location));
      const writes = need.flatMap((p, i) => {
        const row = rows[i];
        if (!row) {
          travel.set(p.id, estimate(origin, p.location));
          estimated++;
          return [];
        }
        travel.set(p.id, { ...row, source: "route" });
        routed++;
        return [{ _id: `${key}:${p.id}`, ...row, at: new Date() }];
      });
      log.line("travel.ors", { destinations: need.length, routed, unroutable: estimated, ms: Date.now() - started });
      await writeTravelCache(writes).catch((err) => log.error("travel.cache.write.fail", err));
    } catch (err) {
      log.error("travel.ors.fail", err, { destinations: need.length, fallback: "estimate" });
      for (const p of need) travel.set(p.id, estimate(origin, p.location));
      estimated += need.length;
    }
  }

  log.json("travel.done", { skipped }, {
    from: origin.label,
    tz: origin.tz,
    radius: radiusMiles,
    cached: hits.size,
    routed,
    estimated,
    skipped: skipped.length,
  });
  return { travel, skipped };
}
