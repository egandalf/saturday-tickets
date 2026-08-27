import { log, withDeal } from "./log";
import { loadPlacesFromAtlas } from "./mongo";
import { PLACES, type Place } from "./places";

export type Ticket = {
  id: string;
  title: string;
  surface: Place["surface"];
  daylight: "BACK BEFORE DUSK";
  photo: string;
  photoAlt: string;
  credit?: string;
};

const HOME_RADIUS_MILES = 150;
const DUSK_MINUTES = 19 * 60 + 30;

function loadNotes(): string[] {
  const notes: string[] = [];
  log.line("load.notes", { source: "empty", count: notes.length });
  return notes;
}

async function retrieve(): Promise<{
  places: Place[];
  source: "atlas" | "seed";
  via?: "vector" | "find";
  reason?: string;
}> {
  const fromAtlas = await loadPlacesFromAtlas(HOME_RADIUS_MILES);
  if (fromAtlas && fromAtlas.places.length) {
    log.line("retrieve.atlas", {
      via: fromAtlas.via,
      count: fromAtlas.places.length,
      ids: fromAtlas.places.map((p) => p.id),
      radius: HOME_RADIUS_MILES,
    });
    return { places: fromAtlas.places, source: "atlas", via: fromAtlas.via };
  }

  const seed = PLACES.filter((p) => p.milesFromHome <= HOME_RADIUS_MILES && Boolean(p.photo));
  const reason = fromAtlas ? "atlas places empty" : "atlas unavailable";
  log.line("retrieve.seed", {
    reason,
    count: seed.length,
    ids: seed.map((p) => p.id),
    radius: HOME_RADIUS_MILES,
  });
  return { places: seed, source: "seed", reason };
}

function rejectReason(p: Place, saturdayStartMinutes: number): string | null {
  if (!p.photo) return "no photo";
  if (p.surface !== "PAVED" && p.surface !== "PACKED GRAVEL") return `surface ${p.surface}`;
  if (!p.turnaround) return "no turnaround";
  if (p.waterCrossing) return "water crossing";
  if (p.clayWhenWet) return "clay when wet";
  const back = saturdayStartMinutes + p.minutesOut + p.onSiteMinutes + p.minutesOut;
  if (back > DUSK_MINUTES) return `back after dusk (${back} > ${DUSK_MINUTES})`;
  return null;
}

function hardFilter(places: Place[], saturdayStartMinutes = 10 * 60): Place[] {
  const dropped: { id: string; reason: string }[] = [];
  const keptList: Place[] = [];
  for (const p of places) {
    const reason = rejectReason(p, saturdayStartMinutes);
    if (reason) dropped.push({ id: p.id, reason });
    else keptList.push(p);
  }
  log.json("filter.hard", { kept: keptList.map((p) => p.id), dropped }, {
    in: places.length,
    out: keptList.length,
    start: "10:00",
    dusk: "19:30",
  });
  return keptList;
}

function toTicket(p: Place): Ticket {
  return {
    id: p.id,
    title: p.title,
    surface: p.surface,
    daylight: "BACK BEFORE DUSK",
    photo: p.photo,
    photoAlt: p.photoAlt,
    credit: p.credit,
  };
}

function fallbackDeal(filtered: Place[]): Ticket[] {
  const tickets = filtered.slice(0, 3).map(toTicket);
  log.line("deal.fallback", { count: tickets.length, ids: tickets.map((t) => t.id) });
  return tickets;
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

  const candidates = filtered.map((p) => ({
    id: p.id,
    title: p.title,
    surface: p.surface,
    milesFromHome: p.milesFromHome,
  }));
  log.json("gemini.request", candidates, {
    model: "gemini-2.5-flash-lite",
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
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
    }
  );
  const ms = Date.now() - started;
  if (!res.ok) {
    const text = await res.text();
    log.line("gemini.http.fail", { status: res.status, ms, body: text.slice(0, 240) });
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }[] };
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

export async function dealSaturday(): Promise<Ticket[]> {
  return withDeal(async () => {
    const t0 = Date.now();
    log.line("deal.start", { home: "41144", radius: HOME_RADIUS_MILES });
    loadNotes();
    const retrieved = await retrieve();
    const filtered = hardFilter(retrieved.places);
    const ids = await rankWithGemini(filtered);
    let tickets: Ticket[];
    if (!ids) {
      tickets = fallbackDeal(filtered);
    } else {
      const byId = new Map(filtered.map((p) => [p.id, p]));
      tickets = ids
        .map((id) => byId.get(id))
        .filter((p): p is Place => Boolean(p))
        .map(toTicket);
      if (!tickets.length) tickets = fallbackDeal(filtered);
      else log.line("deal.ranked", { ids: tickets.map((t) => t.id) });
    }
    log.json(
      "deal.done",
      tickets.map((t) => ({
        id: t.id,
        title: t.title,
        surface: t.surface,
        daylight: t.daylight,
        photo: t.photo,
        credit: t.credit ?? null,
      })),
      { ms: Date.now() - t0, source: retrieved.source, via: retrieved.via, count: tickets.length }
    );
    return tickets;
  });
}
