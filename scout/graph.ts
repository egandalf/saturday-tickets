/**
 * Scout graph: gap → discover → review (one interrupt per candidate) → stage.
 * Accepted and rejected candidates land in Atlas `candidates`, never in `places`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Annotation, END, interrupt, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Db } from "mongodb";
import { z } from "zod";
import { signedTags } from "../lib/places";
import { Candidate, KINDS, normalizeTitle, type CandidateDoc, type Decision, type Scouted } from "./lib/candidate";
import { describe, enrich, isError } from "./lib/enrich";
import { APP_HOME, straightMiles, type Run } from "./lib/origin";
import { readPage, webSearch } from "./lib/tavily";

export const MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 40;

type Known = { id: string; title: string; source: "places" | "candidates"; status?: string };

export type ReviewRequest = { index: number; total: number; candidate: Scouted; run: Run };

/** Progress lines for whoever is watching: the terminal, or the scout UI's run log. */
export type Emit = (threadId: string, line: string) => void;

const consoleEmit: Emit = (_threadId, line) => console.log(line);

function threadOf(config: LangGraphRunnableConfig): string {
  return String(config.configurable?.thread_id ?? "");
}

export const ScoutState = Annotation.Root({
  run: Annotation<Run>,
  focus: Annotation<string | null>,
  count: Annotation<number>,
  known: Annotation<Known[]>,
  candidates: Annotation<Scouted[]>,
  decisions: Annotation<Decision[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  /** Set only on the per-candidate review tasks fanned out by Send. */
  reviewing: Annotation<ReviewRequest | null>,
});

type State = typeof ScoutState.State;

const KIND_HINTS: Record<(typeof KINDS)[number], string> = {
  lake: "swimming beaches, lakeshore parks, dams with overlooks, marinas with picnic areas",
  woods: "state forests, nature preserves, caves, arches, easy trails from a paved lot",
  town: "walkable river towns, murals, main streets, floodwall art, small-town squares",
  history: "historic sites, covered bridges, iron furnaces, mounds, forts, museums with parking",
};

const SYSTEM = `You scout Saturday day trips for a family whose home is ${APP_HOME.label}.

What makes a place fit:
- Paved or packed-gravel road all the way to parking, room to turn a full-size vehicle around, no clay roads that get slick after rain.
- Established, maintained water crossings (low-water bridges, concrete fords on public roads) are acceptable only when documented: the waterway, where on the route, typical depth, when it floods or closes, and any bypass.
- Something for a family to do for two to four hours. Public places only: parks, preserves, historic sites, towns. Not restaurants, shops, or private businesses.

How to work:
- Every fact comes from a page you read. When the pages don't say, answer "unknown"; never guess to fill a field.
- Copy coordinates from a source page (Wikipedia, the park's own page, a government listing) and name it in locationSource.
- Submit each place with submit_candidate. It tells you when a place is already known or outside the search radius; move on to another place when it does.
- When it records a place, it also routes the drive from home and checks the approach, parking, and photos from open data, and returns flags (a ford, rough surface, coordinates far from a road). Research a flag when the pages can settle it, then resubmit the same id with what you learned: waterCrossing and its notes, turnaround, clayWhenWet, a parking-lot coordinate, or a concern. Resubmitting replaces the earlier entry.
- When you have submitted the number asked for, stop and reply with one line summarizing what you found.`;

function brief(state: State): string {
  const focus = state.focus ?? "any";
  const hint = (KINDS as readonly string[]).includes(focus) ? ` (${KIND_HINTS[focus as (typeof KINDS)[number]]})` : "";
  const known = state.known.map((k) => k.title).join("; ");
  return [
    `Find ${state.count} new places. Focus: ${focus}${hint}.`,
    `Search within ${state.run.radiusMiles} miles of ${state.run.origin.label} (${state.run.origin.lat}, ${state.run.origin.lng}).`,
    `Already known, do not submit: ${known || "none"}.`,
  ].join("\n");
}

/** Load what's known and pick the thinnest kind when the run didn't name a focus. */
function gapNode(db: Db, emit: Emit) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    const places = await db.collection("places").find({}, { projection: { _id: 0, id: 1, title: 1 } }).toArray();
    const staged = await db
      .collection("candidates")
      .find({}, { projection: { _id: 0, id: 1, title: 1, status: 1 } })
      .toArray();
    const known: Known[] = [
      ...places.map((p) => ({ id: String(p.id), title: String(p.title), source: "places" as const })),
      ...staged.map((c) => ({ id: String(c.id), title: String(c.title), source: "candidates" as const, status: String(c.status) })),
    ];

    const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<(typeof KINDS)[number], number>;
    for (const p of places) for (const tag of signedTags(String(p.id))) counts[tag]++;
    const focus = state.focus ?? KINDS.reduce((a, b) => (counts[b] < counts[a] ? b : a));
    emit(threadOf(config), `gap: ${KINDS.map((k) => `${k} ${counts[k]}`).join(", ")} → focus ${focus}; ${known.length} known`);
    return { known, focus, candidates: [] };
  };
}

function discoverNode(client: Anthropic, emit: Emit) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    const say = (line: string) => emit(threadOf(config), line);
    const found: Scouted[] = [];
    const ids = new Set(state.known.map((k) => k.id));
    const titles = new Map(state.known.map((k) => [normalizeTitle(k.title), k.id]));

    const tools = [
      betaZodTool({
        name: "web_search",
        description: "Search the web. Returns titles, URLs, and short snippets. Read a page for details.",
        inputSchema: z.object({ query: z.string() }),
        run: async ({ query }) => JSON.stringify(await webSearch(query)),
      }),
      betaZodTool({
        name: "read_page",
        description: "Read one web page as markdown, trimmed to the parts most relevant to your question.",
        inputSchema: z.object({ url: z.url(), question: z.string().describe("What you need from this page") }),
        run: async ({ url, question }) => readPage(url, question),
      }),
      betaZodTool({
        name: "submit_candidate",
        description: "Record one place for the family to review. Returns whether it was recorded.",
        inputSchema: Candidate,
        run: async (c) => {
          const at = found.findIndex((f) => f.id === c.id);
          if (at < 0 && found.length >= state.count) return `Already have ${state.count}. Stop and summarize.`;
          const dupe = at >= 0 ? undefined : ids.has(c.id) ? c.id : titles.get(normalizeTitle(c.title));
          if (dupe) return `Not recorded: already known as ${dupe}. Find a different place.`;
          const miles = straightMiles(state.run.origin, c.location);
          if (miles > state.run.radiusMiles) {
            return `Not recorded: ${miles.toFixed(0)} mi from ${state.run.origin.label}, outside the ${state.run.radiusMiles} mi radius.`;
          }
          if (c.turnaround === "no" || c.clayWhenWet === "yes") {
            return `Not recorded: ${c.turnaround === "no" ? "no turnaround" : "clay when wet"}. Find a different place.`;
          }
          const scouted: Scouted = { ...c, enrichment: await enrich(c.location) };
          if (at >= 0) found[at] = scouted;
          else found.push(scouted);
          ids.add(c.id);
          titles.set(normalizeTitle(c.title), c.id);

          const { summary, flags } = describe(scouted.enrichment);
          const route = scouted.enrichment.route;
          if (!isError(route) && c.surface !== "UNKNOWN" && route.suggestedSurface !== "UNKNOWN" && route.suggestedSurface !== c.surface) {
            flags.push(`you said ${c.surface}; the mapped approach reads ${route.suggestedSurface}`);
          }
          if (!isError(route) && route.fords.length && c.waterCrossing === "none") {
            flags.push("you said no water crossing, but the route crosses a ford");
          }
          const verb = at >= 0 ? "Updated" : "Recorded";
          return [
            `${verb} ${c.id} (${found.length} of ${state.count}). ${summary}`,
            flags.length ? `Flags:\n- ${flags.join("\n- ")}` : "No flags.",
          ].join("\n");
        },
      }),
    ];

    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      max_iterations: MAX_ITERATIONS,
      system: SYSTEM,
      tools,
      messages: [{ role: "user", content: brief(state) }],
    });

    let turns = 0;
    for await (const message of runner) {
      turns++;
      for (const block of message.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          const shown = block.name === "submit_candidate" ? `${input.id} · ${input.title}` : JSON.stringify(input);
          say(`  ${block.name}  ${shown.length > 140 ? `${shown.slice(0, 140)}…` : shown}`);
        }
      }
      if (message.stop_reason === "refusal") say(`  refusal: ${JSON.stringify(message.stop_details)}`);
    }
    const final = await runner.done();
    const summary = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    say(`discover: ${found.length} candidates in ${turns} turns (${final.stop_reason})`);
    if (summary) say(`  ${summary}`);
    return { candidates: found };
  };
}

/** One task per candidate, each paused on its own interrupt, so they can be decided in any order. */
function reviewNode(state: State): Partial<State> {
  const decision = interrupt<ReviewRequest, Decision>(state.reviewing!);
  return { decisions: [decision] };
}

function fanOut(state: State): Send[] | typeof END {
  if (!state.candidates.length) return END;
  return state.candidates.map(
    (candidate, index) =>
      new Send("review", { reviewing: { index, total: state.candidates.length, candidate, run: state.run } }),
  );
}

function stageNode(db: Db, emit: Emit) {
  return async (state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> => {
    const threadId = threadOf(config);
    const byId = new Map(state.candidates.map((c) => [c.id, c]));
    const now = new Date();
    const writes = state.decisions.flatMap((d) => {
      const c = byId.get(d.id);
      if (!c || d.decision === "skip") return [];
      const photos = isError(c.enrichment.photos) ? [] : c.enrichment.photos;
      const doc: CandidateDoc =
        d.decision === "accept"
          ? {
              ...c,
              status: "accepted",
              tags: d.tags,
              photo: d.photo === null ? null : (photos[d.photo] ?? null),
              reviewNote: d.note,
              scoutedFrom: state.run,
              threadId,
              reviewedAt: now,
            }
          : { ...c, status: "rejected", rejectReason: d.reason, scoutedFrom: state.run, threadId, reviewedAt: now };
      return [{ updateOne: { filter: { id: c.id }, update: { $set: doc }, upsert: true } }];
    });
    if (writes.length) await db.collection("candidates").bulkWrite(writes);
    const tally = (k: Decision["decision"]) => state.decisions.filter((d) => d.decision === k).length;
    emit(threadId, `stage: ${tally("accept")} accepted, ${tally("reject")} rejected, ${tally("skip")} skipped → ${db.databaseName}.candidates`);
    return {};
  };
}

export function buildGraph(db: Db, options: { client?: Anthropic; emit?: Emit } = {}) {
  const client = options.client ?? new Anthropic();
  const emit = options.emit ?? consoleEmit;
  return new StateGraph(ScoutState)
    .addNode("gap", gapNode(db, emit))
    .addNode("discover", discoverNode(client, emit))
    .addNode("review", reviewNode)
    .addNode("stage", stageNode(db, emit))
    .addEdge(START, "gap")
    .addEdge("gap", "discover")
    .addConditionalEdges("discover", fanOut, ["review", END])
    .addEdge("review", "stage")
    .addEdge("stage", END);
}
