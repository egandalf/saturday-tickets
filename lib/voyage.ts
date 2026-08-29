import { log } from "./log";

const MODEL = "voyage-3-lite";

type GlobalVoyage = {
  __ticketsQueryEmbeds?: Map<string, number[]>;
};

const g = globalThis as typeof globalThis & GlobalVoyage;

function cache(): Map<string, number[]> {
  if (!g.__ticketsQueryEmbeds) g.__ticketsQueryEmbeds = new Map();
  return g.__ticketsQueryEmbeds;
}

async function requestEmbed(key: string, text: string): Promise<number[] | null> {
  const started = Date.now();
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: MODEL, input_type: "query" }),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const body = (await res.text()).slice(0, 240);
    log.line("voyage.http.fail", { status: res.status, ms, body });
    return null;
  }

  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!vec?.length) {
    log.line("voyage.empty", { ms });
    return null;
  }

  log.line("voyage.query", { ms, dims: vec.length, model: MODEL });
  return vec;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const hit = cache().get(text);
  if (hit) {
    log.line("voyage.cache", { dims: hit.length, model: MODEL });
    return hit;
  }

  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) {
    log.line("voyage.skip", { reason: "VOYAGE_API_KEY unset" });
    return null;
  }

  const vec = await requestEmbed(key, text);
  if (!vec) return null;

  cache().set(text, vec);
  return vec;
}
