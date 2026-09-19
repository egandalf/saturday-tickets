/** Tavily web search and page extract for the discover agent. Results are trimmed before Claude reads them. */

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";
const SNIPPET_CHARS = 600;
const PAGE_CHARS = 8000;

export type SearchHit = { title: string; url: string; content: string };

function key(): string {
  const value = process.env.TAVILY_API_KEY?.trim();
  if (!value) throw new Error("TAVILY_API_KEY unset");
  return value;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return (await res.json()) as T;
}

/** Basic depth: 1 credit per search. */
export async function webSearch(query: string, maxResults = 6): Promise<SearchHit[]> {
  const data = await post<{ results?: SearchHit[] }>(SEARCH_URL, {
    query,
    search_depth: "basic",
    max_results: maxResults,
    country: "united states",
  });
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content.length > SNIPPET_CHARS ? `${r.content.slice(0, SNIPPET_CHARS)}…` : r.content,
  }));
}

/** One page as markdown, reranked toward `question` so the useful chunks survive the trim. */
export async function readPage(url: string, question: string): Promise<string> {
  const data = await post<{
    results?: { url: string; raw_content: string }[];
    failed_results?: { url: string; error: string }[];
  }>(EXTRACT_URL, { urls: [url], query: question, chunks_per_source: 5, format: "markdown" });
  const page = data.results?.[0];
  if (!page) {
    const failed = data.failed_results?.[0];
    throw new Error(`could not read ${url}${failed ? `: ${failed.error}` : ""}`);
  }
  const text = page.raw_content;
  return text.length > PAGE_CHARS ? `${text.slice(0, PAGE_CHARS)}\n…(trimmed from ${text.length} chars)` : text;
}
