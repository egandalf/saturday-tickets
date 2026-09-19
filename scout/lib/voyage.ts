/** Document embeds for scout. The free tier is a few requests a minute, so batch and wait out 429s. */
import { EMBED_MODEL } from "./place-doc";

const MAX_TRIES = 4;
const BASE_WAIT_MS = 20_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) throw new Error("VOYAGE_API_KEY unset");
  if (!texts.length) return [];

  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts, model: EMBED_MODEL, input_type: "document" }),
    });

    if (res.status === 429 && attempt < MAX_TRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const ms = retryAfter > 0 ? retryAfter * 1000 : BASE_WAIT_MS * attempt;
      console.log(`voyage 429, waiting ${Math.round(ms / 1000)}s (try ${attempt}/${MAX_TRIES})`);
      await wait(ms);
      continue;
    }
    if (!res.ok) throw new Error(`voyage ${res.status}: ${(await res.text()).slice(0, 240)}`);

    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vecs = (data.data ?? []).map((d) => d.embedding ?? []);
    if (vecs.length !== texts.length || vecs.some((v) => !v.length)) {
      throw new Error(`voyage returned ${vecs.length} embeddings for ${texts.length} texts`);
    }
    return vecs;
  }
}
