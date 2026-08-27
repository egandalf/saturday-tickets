import { log } from "./log";

const MODEL = "voyage-3-lite";

type GlobalVoyage = {
  __ticketsQueryEmbed?: { text: string; vec: number[] };
};

const g = globalThis as typeof globalThis & GlobalVoyage;

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
  if (g.__ticketsQueryEmbed?.text === text) {
    log.line("voyage.cache", { dims: g.__ticketsQueryEmbed.vec.length, model: MODEL });
    return g.__ticketsQueryEmbed.vec;
  }

  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) {
    log.line("voyage.skip", { reason: "VOYAGE_API_KEY unset" });
    return null;
  }

  const first = await requestEmbed(key, text);
  const vec = first ?? (await requestEmbed(key, text));
  if (!vec) return null;

  g.__ticketsQueryEmbed = { text, vec };
  return vec;
}
