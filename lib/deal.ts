import { log, takeCalls, withDeal } from "./log";
import { loadPlacesFromAtlas } from "./mongo";
import { PLACES, signedTags, type Place } from "./places";
import { saturdaySunset, type SaturdaySunset } from "./sun";
import type { DealCall } from "./trace";

export type { DealCall };

export type Ticket = {
  id: string;
  title: string;
  surface: Place["surface"];
  daylight: "BACK BEFORE DUSK";
  drive: string;
  onSite: string;
  leaveBy: string;
  photo: string;
  photoAlt: string;
  credit?: string;
};

export const MOODS = ["lake", "woods", "town", "history"] as const;
export type Mood = (typeof MOODS)[number];

export type RetrieveReport = {
  source: "atlas" | "seed";
  via: "vector" | "find" | null;
  operator: "$vectorSearch" | "find" | "seed";
  atlas: { n: number; withCredit: number } | null;
  mood: Mood | null;
};

export type DealResult = {
  tickets: Ticket[];
  retrieve: RetrieveReport;
  calls: DealCall[];
};

const HOME_RADIUS_MILES = 150;
const SATURDAY_START = 10 * 60;
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const FAMILY_QUERY =
  "family Saturday from 41144 Greenup Kentucky, paved or packed gravel, back before dusk";

export function parseMood(value: string | null): Mood | undefined {
  const s = value?.trim().toLowerCase();
  return MOODS.includes(s as Mood) ? (s as Mood) : undefined;
}

function loadNotes(): string[] {
  const notes: string[] = [];
  log.line("load.notes", { source: "empty", count: notes.length });
  return notes;
}

function coverage(places: Place[]): { n: number; withCredit: number } {
  return {
    n: places.length,
    withCredit: places.filter((p) => Boolean(p.credit)).length,
  };
}

function reportOf(
  retrieved: { source: "atlas" | "seed"; via?: "vector" | "find" },
  places: Place[],
  mood?: Mood,
): RetrieveReport {
  const atlas = retrieved.source === "atlas" ? coverage(places) : null;
  const moodValue = mood ?? null;
  if (retrieved.via === "vector") {
    return { source: "atlas", via: "vector", operator: "$vectorSearch", atlas, mood: moodValue };
  }
  if (retrieved.source === "atlas") {
    return { source: "atlas", via: "find", operator: "find", atlas, mood: moodValue };
  }
  return { source: "seed", via: null, operator: "seed", atlas: null, mood: moodValue };
}

async function retrieve(mood?: Mood): Promise<{
  places: Place[];
  source: "atlas" | "seed";
  via?: "vector" | "find";
  reason?: string;
}> {
  const fromAtlas = await loadPlacesFromAtlas(HOME_RADIUS_MILES, FAMILY_QUERY);
  if (fromAtlas && fromAtlas.places.length) {
    log.line("retrieve.atlas", {
      via: fromAtlas.via,
      mood: mood ?? "none",
      count: fromAtlas.places.length,
      withCredit: fromAtlas.places.filter((p) => Boolean(p.credit)).length,
      ids: fromAtlas.places.map((p) => p.id),
      radius: HOME_RADIUS_MILES,
    });
    return { places: fromAtlas.places, source: "atlas", via: fromAtlas.via };
  }

  const seed = PLACES.filter((p) => p.milesFromHome <= HOME_RADIUS_MILES && Boolean(p.photo));
  const reason = fromAtlas ? "atlas places empty" : "atlas unavailable";
  log.line("retrieve.seed", {
    reason,
    mood: mood ?? "none",
    count: seed.length,
    ids: seed.map((p) => p.id),
    radius: HOME_RADIUS_MILES,
  });
  return { places: seed, source: "seed", reason };
}

function rejectReason(p: Place, saturdayStartMinutes: number, duskMinutes: number): string | null {
  if (!p.photo) return "no photo";
  if (p.surface !== "PAVED" && p.surface !== "PACKED GRAVEL") return `surface ${p.surface}`;
  if (!p.turnaround) return "no turnaround";
  if (p.waterCrossing) return "water crossing";
  if (p.clayWhenWet) return "clay when wet";
  const back = saturdayStartMinutes + p.minutesOut + p.onSiteMinutes + p.minutesOut;
  if (back > duskMinutes) return `back after dusk (${back} > ${duskMinutes})`;
  return null;
}

function hardFilter(places: Place[], dusk: SaturdaySunset, saturdayStartMinutes = SATURDAY_START): Place[] {
  const dropped: { id: string; reason: string }[] = [];
  const keptList: Place[] = [];
  for (const p of places) {
    const reason = rejectReason(p, saturdayStartMinutes, dusk.minutes);
    if (reason) dropped.push({ id: p.id, reason });
    else keptList.push(p);
  }
  log.json("filter.hard", { kept: keptList.map((p) => p.id), dropped }, {
    in: places.length,
    out: keptList.length,
    start: "10:00",
    saturday: dusk.date,
    dusk: dusk.clock,
  });
  return keptList;
}

function isSignedTag(p: Place, mood: Mood): boolean {
  return signedTags(p.id).includes(mood);
}

function kindFilter(places: Place[], mood?: Mood): Place[] {
  if (!mood) return places;
  const kept: Place[] = [];
  const dropped: string[] = [];
  for (const p of places) {
    if (isSignedTag(p, mood)) kept.push(p);
    else dropped.push(p.id);
  }
  log.json("filter.kind", { kept: kept.map((p) => p.id), dropped }, { mood });
  return kept;
}

function clock(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return minute === 0 ? `${hour} ${suffix}` : `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function driveLabel(minutes: number): string {
  return `${minutes} min drive`;
}

function onSiteLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hr on site`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} hr ${minutes % 60} min on site`;
  return `${minutes} min on site`;
}

function leaveByLabel(place: Place, duskMinutes: number): string {
  return `leave by ${clock(duskMinutes - place.minutesOut)}`;
}

function toTicket(p: Place, duskMinutes: number): Ticket {
  return {
    id: p.id,
    title: p.title,
    surface: p.surface,
    daylight: "BACK BEFORE DUSK",
    drive: driveLabel(p.minutesOut),
    onSite: onSiteLabel(p.onSiteMinutes),
    leaveBy: leaveByLabel(p, duskMinutes),
    photo: p.photo,
    photoAlt: p.photoAlt,
    credit: p.credit,
  };
}

function fallbackDeal(filtered: Place[], duskMinutes: number): Ticket[] {
  const tickets = filtered.slice(0, 3).map((p) => toTicket(p, duskMinutes));
  log.line("deal.fallback", { count: tickets.length, ids: tickets.map((t) => t.id) });
  return tickets;
}

async function geminiGenerate(key: string, body: unknown): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(body),
  });
}

async function rankWithGemini(filtered: Place[]): Promise<string[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    log.line("gemini.skip", { reason: "GEMINI_API_KEY unset" });
    return null;
  }
  if (filtered.length === 0) {
    log.line("gemini.skip", { reason: "no filtered places" });
    return null;
  }
  if (filtered.length < 3) {
    log.line("gemini.skip", { reason: "fewer than three after kind filter", n: filtered.length });
    return null;
  }

  const candidates = filtered.map((p) => ({
    id: p.id,
    title: p.title,
    surface: p.surface,
    milesFromHome: p.milesFromHome,
  }));
  log.json("gemini.request", candidates, {
    model: GEMINI_MODEL,
    n: candidates.length,
  });

  const body = {
    contents: [
      {
        parts: [
          {
            text: [
              "Deal exactly three Saturday tickets from this list.",
              "Do not invent places. Do not promote a pin because it looks remote.",
              "Return JSON only: {\"ids\":[\"id\",\"id\",\"id\"]}",
              JSON.stringify(candidates),
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  };

  const started = Date.now();
  let res = await geminiGenerate(key, body);
  if (res.status === 429) {
    log.line("gemini.http.retry", { status: 429 });
    res = await geminiGenerate(key, body);
  }
  const ms = Date.now() - started;
  if (!res.ok) {
    const text = await res.text();
    log.line("gemini.http.fail", { status: res.status, ms, body: text.slice(0, 240) });
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    log.line("gemini.empty", { ms });
    return null;
  }
  const parsed = JSON.parse(text) as { ids?: string[] };
  const allowed = new Set(filtered.map((p) => p.id));
  const ids = (parsed.ids ?? []).filter((id) => allowed.has(id)).slice(0, 3);
  log.json("gemini.response", { raw: parsed, kept: ids }, { ms, status: res.status });
  return ids.length ? ids : null;
}

export async function dealSaturday(mood?: Mood): Promise<DealResult> {
  return withDeal(async () => {
    const t0 = Date.now();
    const dusk = saturdaySunset();
    log.line("deal.start", {
      home: "41144",
      radius: HOME_RADIUS_MILES,
      mood: mood ?? "none",
      saturday: dusk.date,
      dusk: dusk.clock,
    });
    loadNotes();
    const retrieved = await retrieve(mood);
    const retrievePath = reportOf(retrieved, retrieved.places, mood);
    const filtered = kindFilter(hardFilter(retrieved.places, dusk), mood);
    const ids = await rankWithGemini(filtered);
    let tickets: Ticket[];
    if (!ids) {
      tickets = fallbackDeal(filtered, dusk.minutes);
    } else {
      const byId = new Map(filtered.map((p) => [p.id, p]));
      tickets = ids
        .map((id) => byId.get(id))
        .filter((p): p is Place => Boolean(p))
        .map((p) => toTicket(p, dusk.minutes));
      if (!tickets.length) tickets = fallbackDeal(filtered, dusk.minutes);
      else log.line("deal.ranked", { ids: tickets.map((t) => t.id) });
    }
    log.json(
      "deal.done",
      tickets.map((t) => ({
        id: t.id,
        title: t.title,
        surface: t.surface,
        daylight: t.daylight,
        drive: t.drive,
        onSite: t.onSite,
        leaveBy: t.leaveBy,
        photo: t.photo,
        credit: t.credit ?? null,
      })),
      {
        ms: Date.now() - t0,
        source: retrievePath.source,
        via: retrievePath.via,
        operator: retrievePath.operator,
        mood: retrievePath.mood,
        atlas: retrievePath.atlas,
        saturday: dusk.date,
        dusk: dusk.clock,
        count: tickets.length,
      },
    );
    return { tickets, retrieve: retrievePath, calls: takeCalls() };
  });
}
