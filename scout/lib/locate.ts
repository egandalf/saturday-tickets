/**
 * Pin an existing place to where the family parks, then route it from home. Findings go to
 * scout/data/locations.json; applying them to places is a separate, reviewed step (travel.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import { MODEL } from "../graph";
import { parkingNear, routeFromHome } from "./enrich";
import { geocode } from "./geocode";
import { APP_HOME, straightMiles } from "./origin";
import { readPage, webSearch } from "./tavily";
import { loadLocations, saveLocations, type Located } from "./travel";

export type Say = (line: string) => void;

const MAX_ITERATIONS = 24;

const SYSTEM = `You pin places to the exact spot a family parks, so drive times from home (${APP_HOME.label}) can be routed.

- The photo description and note say which part of a place the family visits (a beach, an overlook, a trailhead). Pin that spot's parking lot or entrance, not the center of the park or the nearest town.
- geocode gives a first guess and is often a centroid or a namesake elsewhere. parking_near lists mapped lots with coordinates around a point. Confirm the spot with a page you read (the park's map or page, Wikipedia, a government listing).
- Submit a best guess with submit_location as soon as you have a plausible point, then refine; a later submission replaces it. It routes from home and reports the drive, how far the point sits from a road, and parking nearby. If the point is far from a road or the drive looks wrong for the place, refine and resubmit.
- Say in "what" how sure you are when the spot is inferred rather than confirmed.
- Finish with one line naming the spot you pinned.`;

export async function locate(client: Anthropic, place: Document, say: Say = console.log): Promise<Located | null> {
  let last: Located | null = null;
  const tools = [
    betaZodTool({
      name: "geocode",
      description: "Look up a place name or address. Returns candidate points; verify before trusting.",
      inputSchema: z.object({ text: z.string() }),
      run: async ({ text }) => JSON.stringify(await geocode(text)),
    }),
    betaZodTool({
      name: "web_search",
      description: "Search the web. Returns titles, URLs, and short snippets.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => JSON.stringify(await webSearch(query)),
    }),
    betaZodTool({
      name: "read_page",
      description: "Read one web page as markdown, trimmed to the parts most relevant to your question.",
      inputSchema: z.object({ url: z.url(), question: z.string() }),
      run: async ({ url, question }) => readPage(url, question),
    }),
    betaZodTool({
      name: "parking_near",
      description: "Mapped parking lots (name, surface, coordinates, distance) and turning circles around a point.",
      inputSchema: z.object({ lat: z.number(), lng: z.number(), radiusMeters: z.number().int().min(100).max(3000) }),
      run: async ({ lat, lng, radiusMeters }) => JSON.stringify(await parkingNear({ lat, lng }, radiusMeters)),
    }),
    betaZodTool({
      name: "submit_location",
      description: "Record where the family parks. Returns the routed drive from home to check it.",
      inputSchema: z.object({
        lat: z.number(),
        lng: z.number(),
        what: z.string().describe("The spot, e.g. 'beach parking lot off KY-1711'"),
        source: z.string().describe("URL or page that confirms it"),
      }),
      run: async ({ lat, lng, what, source }) => {
        const route = await routeFromHome({ lat, lng });
        last = { id: String(place.id), title: String(place.title), lat, lng, what, source, route, at: new Date().toISOString() };
        const parking = await parkingNear({ lat, lng }, 300).catch(() => null);
        return [
          `Recorded. Drive from home: ${route.miles} mi, ${route.minutes} min; ${straightMiles(APP_HOME, { lat, lng }).toFixed(1)} mi straight-line.`,
          `Point is ${route.snapMiles} mi from the nearest routable road.`,
          parking ? `Mapped lots within 300 m: ${parking.lots.length}${parking.lots[0] ? `, nearest ${parking.lots[0].meters} m` : ""}.` : "Parking lookup unavailable.",
        ].join(" ");
      },
    }),
  ];

  const brief = [
    `Place: ${place.title} (id ${place.id}).`,
    `Photo: ${place.photoAlt}.`,
    place.note ? `Note: ${place.note}.` : null,
    `Surface to parking on file: ${place.surface}.`,
    `On file as ${place.milesFromHome} mi / ${place.minutesOut} min from home; those numbers may be wrong, don't fit to them.`,
  ]
    .filter(Boolean)
    .join("\n");

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: MAX_ITERATIONS,
    system: SYSTEM,
    tools,
    messages: [{ role: "user", content: brief }],
  });
  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "tool_use") {
        const shown = JSON.stringify(block.input);
        say(`    ${block.name}  ${shown.length > 120 ? `${shown.slice(0, 120)}…` : shown}`);
      }
    }
  }
  const final = await runner.done();
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
  if (text) say(`    → ${text}`);
  return last;
}

/** Locate these ids, or every place without a location or a finding. Saves after each place. */
export async function locateMany(db: Db, ids: string[] | undefined, say: Say = console.log): Promise<number> {
  const found = await loadLocations();
  const places = await db
    .collection("places")
    .find(ids ? { id: { $in: ids } } : { location: { $exists: false } }, { projection: { embedding: 0 } })
    .sort({ milesFromHome: 1 })
    .toArray();
  const todo = ids ? places : places.filter((p) => !found[String(p.id)]);
  say(`locating ${todo.length} place(s) with ${MODEL}`);
  const client = new Anthropic();
  let saved = 0;
  for (const place of todo) {
    say(`${place.id} · ${place.title}`);
    const hit = await locate(client, place, say);
    if (!hit) {
      say("    no location submitted");
      continue;
    }
    found[hit.id] = hit;
    await saveLocations(found);
    saved++;
    say(`    saved: ${hit.lat}, ${hit.lng} · ${hit.route.miles} mi, ${hit.route.minutes} min (on file ${place.milesFromHome} mi, ${place.minutesOut} min)`);
  }
  return saved;
}
