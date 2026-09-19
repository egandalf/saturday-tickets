import { z } from "zod";
import { geocode as geocodeText } from "../../lib/geocode";
import { readPage, webSearch } from "../../lib/tavily";
import type { ToolDef } from "../types";

export const web_search: ToolDef<{ query: string }> = {
  name: "web_search",
  description: "Search the web (Tavily). Returns titles, URLs, and short snippets. Read a page for details before relying on it.",
  effect: "read",
  input: z.object({ query: z.string().min(2) }),
  run: ({ query }) => webSearch(query),
};

export const read_page: ToolDef<{ url: string; question: string }> = {
  name: "read_page",
  description: "Read one web page as markdown, trimmed to the parts most relevant to your question.",
  effect: "read",
  input: z.object({ url: z.url(), question: z.string().min(3).describe("What you need from this page") }),
  run: ({ url, question }) => readPage(url, question),
};

export const geocode: ToolDef<{ text: string }> = {
  name: "geocode",
  description:
    "Look up a place name or address (OpenRouteService). Returns candidate points; often a centroid or a namesake elsewhere, so confirm with a page.",
  effect: "read",
  input: z.object({ text: z.string().min(2) }),
  run: ({ text }) => geocodeText(text),
};
