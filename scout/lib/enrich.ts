/**
 * Facts the web pages rarely state, from open data: the drive from home and what the approach
 * is paved with (OpenRouteService on OpenStreetMap), mapped parking (Overpass), and licensed
 * photos nearby (Wikimedia Commons). Each source can fail on its own; the rest still land.
 */
import { APP_HOME, straightMiles } from "./origin";

const UA = "saturday-tickets-scout/0.1 (https://github.com/egandalf/saturday-tickets)";
const METERS_PER_MILE = 1609.344;
const APPROACH_MILES = 5;
const TIMEOUT_MS = 25_000;

type LatLng = { lat: number; lng: number };

/** ORS surface codes. Metal and wood are bridge decks. */
const PAVED = new Set([1, 3, 4, 5, 6, 7, 14, 18]);
const GRAVEL = new Set([8, 9, 10]);
const SURFACE_NAMES: Record<number, string> = {
  0: "unknown", 1: "paved", 2: "unpaved", 3: "asphalt", 4: "concrete", 5: "cobblestone", 6: "metal", 7: "wood",
  8: "compacted gravel", 9: "fine gravel", 10: "gravel", 11: "dirt", 12: "ground", 13: "ice", 14: "paving stones",
  15: "sand", 16: "woodchips", 17: "grass", 18: "grass paver",
};
const WAYCATEGORY_FERRY = 8;
const WAYCATEGORY_FORD = 16;
const WAYTYPE_TRACK = 5;

export type Stretch = { what: string; miles: number; milesFromEnd: number };

export type RouteFacts = {
  miles: number;
  minutes: number;
  /** How far the given coordinates sit from the nearest routable road. */
  snapMiles: number;
  approach: { paved: number; gravel: number; rough: number; unknown: number };
  suggestedSurface: "PAVED" | "PACKED GRAVEL" | "ROUGH" | "UNKNOWN";
  rough: Stretch[];
  tracks: Stretch[];
  fords: Stretch[];
  ferries: Stretch[];
  /** Only when the route crosses a ford: the same trip with fords avoided. */
  fordBypass?: { extraMinutes: number } | { error: string };
};

export type ParkingFacts = {
  lots: { meters: number; lat: number; lng: number; name?: string; surface?: string; access?: string }[];
  turningCircles: number;
};

export type Photo = {
  title: string;
  pageUrl: string;
  url: string;
  width: number;
  height: number;
  license: string;
  credit: string;
  description: string;
  meters: number;
};

export type Enrichment = {
  at: string;
  route: RouteFacts | { error: string };
  parking: ParkingFacts | { error: string };
  photos: Photo[] | { error: string };
};

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function failed(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}

async function orsRoute(to: LatLng, avoidFords: boolean) {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) throw new Error("ORS_API_KEY unset");
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      coordinates: [
        [APP_HOME.lng, APP_HOME.lat],
        [to.lng, to.lat],
      ],
      extra_info: ["surface", "waycategory", "waytype"],
      radiuses: [-1, -1],
      instructions: false,
      ...(avoidFords ? { options: { avoid_features: ["fords"] } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ors ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    features: {
      geometry: { coordinates: [number, number][] };
      properties: {
        summary: { distance: number; duration: number };
        extras: Record<string, { values: [number, number, number][] }>;
      };
    }[];
  };
  const route = data.features[0];
  if (!route) throw new Error("ors returned no route");
  return route;
}

export async function routeFromHome(to: LatLng): Promise<RouteFacts> {
  const route = await orsRoute(to, false);
  const coords = route.geometry.coordinates;
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
    const b = { lng: coords[i][0], lat: coords[i][1] };
    cumulative.push(cumulative[i - 1] + straightMiles(a, b));
  }
  const total = cumulative[cumulative.length - 1];
  const stretches = (kind: string, pick: (value: number) => string | null): Stretch[] =>
    (route.properties.extras[kind]?.values ?? []).flatMap(([start, end, value]) => {
      const what = pick(value);
      if (!what) return [];
      return [{ what, miles: round(cumulative[end] - cumulative[start], 2), milesFromEnd: round(total - cumulative[end], 1) }];
    });

  const approach = { paved: 0, gravel: 0, rough: 0, unknown: 0 };
  for (const [start, end, value] of route.properties.extras.surface?.values ?? []) {
    const from = Math.max(cumulative[start], total - APPROACH_MILES);
    const miles = cumulative[end] - from;
    if (miles <= 0) continue;
    const bucket = value === 0 ? "unknown" : PAVED.has(value) ? "paved" : GRAVEL.has(value) ? "gravel" : "rough";
    approach[bucket] += miles;
  }
  for (const k of Object.keys(approach) as (keyof typeof approach)[]) approach[k] = round(approach[k], 2);

  const window = Math.min(APPROACH_MILES, total);
  const suggestedSurface =
    approach.rough > 0.05
      ? "ROUGH"
      : approach.gravel > 0.05
        ? "PACKED GRAVEL"
        : approach.paved >= window / 2
          ? "PAVED"
          : "UNKNOWN";

  const end = coords[coords.length - 1];
  const facts: RouteFacts = {
    miles: round(route.properties.summary.distance / METERS_PER_MILE),
    minutes: Math.ceil(route.properties.summary.duration / 60),
    snapMiles: round(straightMiles(to, { lng: end[0], lat: end[1] }), 2),
    approach,
    suggestedSurface,
    rough: stretches("surface", (v) => (v !== 0 && !PAVED.has(v) && !GRAVEL.has(v) ? SURFACE_NAMES[v] ?? `surface ${v}` : null)),
    tracks: stretches("waytype", (v) => (v === WAYTYPE_TRACK ? "track" : null)),
    fords: stretches("waycategory", (v) => (v & WAYCATEGORY_FORD ? "ford" : null)),
    ferries: stretches("waycategory", (v) => (v & WAYCATEGORY_FERRY ? "ferry" : null)),
  };

  if (facts.fords.length) {
    try {
      const bypass = await orsRoute(to, true);
      facts.fordBypass = { extraMinutes: Math.ceil(bypass.properties.summary.duration / 60) - facts.minutes };
    } catch (err) {
      facts.fordBypass = failed(err);
    }
  }
  return facts;
}

async function overpass(query: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok && !text.startsWith("<")) return text;
    if (attempt >= 2) throw new Error(`overpass ${res.status}: busy or unavailable`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function parkingNear(at: LatLng, radiusMeters = 400): Promise<ParkingFacts> {
  const query = `[out:json][timeout:20];(nwr(around:${radiusMeters},${at.lat},${at.lng})[amenity=parking];node(around:${radiusMeters},${at.lat},${at.lng})[highway=turning_circle];);out center tags;`;
  const text = await overpass(query);
  const data = JSON.parse(text) as {
    elements: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
  };
  const lots: ParkingFacts["lots"] = [];
  let turningCircles = 0;
  for (const e of data.elements) {
    if (e.tags?.highway === "turning_circle") {
      turningCircles++;
      continue;
    }
    const p = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    if (!p) continue;
    lots.push({
      meters: Math.round(straightMiles(at, { lat: p.lat, lng: p.lon }) * METERS_PER_MILE),
      lat: round(p.lat, 6),
      lng: round(p.lon, 6),
      name: e.tags?.name,
      surface: e.tags?.surface,
      access: e.tags?.access,
    });
  }
  lots.sort((a, b) => a.meters - b.meters);
  return { lots, turningCircles };
}

const OPEN_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?)/i;

function plain(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

type CommonsPage = {
  title: string;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: {
    mime: string;
    width: number;
    height: number;
    thumburl?: string;
    url: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
};

async function commons(params: Record<string, string>): Promise<CommonsPage[]> {
  const query = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo|coordinates",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1600",
    iiextmetadatafilter: "LicenseShortName|Artist|ImageDescription",
    ...params,
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`commons ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  return Object.values(data.query?.pages ?? {});
}

/** Landscape JPEGs, 1200px+, openly licensed; meters is -1 when there's no reference point. */
function usablePhotos(pages: CommonsPage[], at?: LatLng): Photo[] {
  const photos: Photo[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = plain(meta.LicenseShortName?.value);
    if (!info || info.mime !== "image/jpeg" || info.width < 1200 || info.width < info.height) continue;
    if (!OPEN_LICENSE.test(license)) continue;
    const where = page.coordinates?.[0];
    const author = plain(meta.Artist?.value) || "Unknown author";
    photos.push({
      title: page.title.replace(/^File:/, "").replace(/\.jpe?g$/i, ""),
      pageUrl: info.descriptionurl,
      url: info.thumburl ?? info.url,
      width: info.width,
      height: info.height,
      license,
      credit: `${author} (${license})`,
      description: plain(meta.ImageDescription?.value).slice(0, 200),
      meters: at && where ? Math.round(straightMiles(at, { lat: where.lat, lng: where.lon }) * METERS_PER_MILE) : -1,
    });
  }
  return photos;
}

/** Openly licensed photos within `radiusMeters`, closest first. Credit reads "Author (License)". */
export async function photosNear(at: LatLng, radiusMeters = 1500, limit = 4): Promise<Photo[]> {
  const pages = await commons({
    generator: "geosearch",
    ggscoord: `${at.lat}|${at.lng}`,
    ggsradius: String(radiusMeters),
    ggsnamespace: "6",
    ggslimit: "30",
  });
  return usablePhotos(pages, at)
    .map((p) => (p.meters < 0 ? { ...p, meters: radiusMeters } : p))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

/** Openly licensed photos found by name, for places whose photos aren't geotagged. */
export async function photosByName(query: string, limit = 6): Promise<Photo[]> {
  const pages = await commons({ generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: "20" });
  return usablePhotos(pages).slice(0, limit);
}

export async function enrich(at: LatLng): Promise<Enrichment> {
  const [route, parking, photos] = await Promise.all([
    routeFromHome(at).catch(failed),
    parkingNear(at).catch(failed),
    photosNear(at).catch(failed),
  ]);
  return { at: new Date().toISOString(), route, parking, photos };
}

export function isError<T extends object>(value: T | { error: string }): value is { error: string } {
  return "error" in value;
}

/** One paragraph for the agent and the review card. Flags are what a parent should look at. */
export function describe(e: Enrichment): { summary: string; flags: string[] } {
  const parts: string[] = [];
  const flags: string[] = [];
  if (isError(e.route)) {
    parts.push(`Route: unavailable (${e.route.error}).`);
  } else {
    const r = e.route;
    const a = r.approach;
    parts.push(
      `Drive from home: ${r.miles} mi, ${r.minutes} min. Last ${APPROACH_MILES} mi: ${a.paved} paved, ${a.gravel} gravel, ${a.rough} rough, ${a.unknown} unknown → ${r.suggestedSurface}.`,
    );
    if (r.snapMiles > 0.25) flags.push(`coordinates are ${r.snapMiles} mi from the nearest road; they may be a park centroid, not the lot`);
    for (const f of r.fords) {
      const bypass = r.fordBypass && !isError(r.fordBypass) ? `; avoiding it adds ${r.fordBypass.extraMinutes} min` : "";
      flags.push(`ford on the route ${f.milesFromEnd} mi before arrival${bypass}`);
    }
    for (const f of r.ferries) flags.push(`ferry on the route ${f.milesFromEnd} mi before arrival`);
    for (const s of r.rough.filter((s) => s.milesFromEnd <= APPROACH_MILES)) {
      flags.push(`${s.miles} mi of ${s.what} ${s.milesFromEnd} mi before arrival (clay-when-wet risk)`);
    }
    const tracks = r.tracks.filter((s) => s.milesFromEnd <= APPROACH_MILES);
    if (tracks.length) flags.push(`${round(tracks.reduce((n, s) => n + s.miles, 0), 2)} mi on tracks in the approach`);
  }
  if (isError(e.parking)) {
    parts.push(`Parking: unavailable (${e.parking.error}).`);
  } else if (e.parking.lots.length || e.parking.turningCircles) {
    const nearest = e.parking.lots[0];
    parts.push(
      `Parking mapped: ${e.parking.lots.length} lot(s)${nearest ? `, nearest ${nearest.meters} m${nearest.surface ? ` (${nearest.surface})` : ""}` : ""}${e.parking.turningCircles ? `, ${e.parking.turningCircles} turning circle(s)` : ""}.`,
    );
  } else {
    parts.push("Parking: none mapped within 400 m (not proof there is none).");
  }
  parts.push(isError(e.photos) ? `Photos: unavailable (${e.photos.error}).` : `Photos: ${e.photos.length} openly licensed nearby.`);
  return { summary: parts.join(" "), flags };
}
