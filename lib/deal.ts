import { PLACES, type Place } from "./places";

export type Ticket = {
  id: string;
  title: string;
  surface: Place["surface"];
  daylight: "BACK BEFORE DUSK";
};

const HOME_RADIUS_MILES = 150;
const DUSK_MINUTES = 19 * 60 + 30;

function loadNotes(): string[] {
  return [];
}

function retrieve(): Place[] {
  return PLACES.filter((p) => p.milesFromHome <= HOME_RADIUS_MILES);
}

function hardFilter(places: Place[], saturdayStartMinutes = 10 * 60): Place[] {
  return places.filter((p) => {
    if (p.surface !== "PAVED" && p.surface !== "PACKED GRAVEL") return false;
    if (!p.turnaround) return false;
    if (p.waterCrossing) return false;
    if (p.clayWhenWet) return false;
    const back = saturdayStartMinutes + p.minutesOut + p.onSiteMinutes + p.minutesOut;
    return back <= DUSK_MINUTES;
  });
}

function fallbackDeal(filtered: Place[]): Ticket[] {
  return filtered.slice(0, 3).map((p) => ({
    id: p.id,
    title: p.title,
    surface: p.surface,
    daylight: "BACK BEFORE DUSK",
  }));
}

async function rankWithGemini(filtered: Place[]): Promise<string[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || filtered.length === 0) return null;

  const body = {
    contents: [
      {
        parts: [
          {
            text: [
              "Deal exactly three Saturday tickets from this list.",
              "Do not invent places. Do not promote a pin because it looks remote.",
              "Return JSON only: {\"ids\":[\"id\",\"id\",\"id\"]}",
              JSON.stringify(filtered.map((p) => ({ id: p.id, title: p.title, surface: p.surface, milesFromHome: p.milesFromHome }))),
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  };

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
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text) as { ids?: string[] };
  const allowed = new Set(filtered.map((p) => p.id));
  const ids = (parsed.ids ?? []).filter((id) => allowed.has(id)).slice(0, 3);
  return ids.length ? ids : null;
}

export async function dealSaturday(): Promise<Ticket[]> {
  loadNotes();
  const filtered = hardFilter(retrieve());
  const ids = await rankWithGemini(filtered);
  if (!ids) return fallbackDeal(filtered);
  const byId = new Map(filtered.map((p) => [p.id, p]));
  const tickets = ids
    .map((id) => byId.get(id))
    .filter((p): p is Place => Boolean(p))
    .map((p) => ({
      id: p.id,
      title: p.title,
      surface: p.surface,
      daylight: "BACK BEFORE DUSK" as const,
    }));
  return tickets.length ? tickets : fallbackDeal(filtered);
}
