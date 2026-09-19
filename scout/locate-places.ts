/**
 * Local only. Pin each existing place to where the family parks, then route it from 41144.
 *
 *   npm run scout:locate -- --ids=greenbo,shawnee-packed    locate these (or every place without a location)
 *   npm run scout:locate -- --apply                          table: stored vs routed miles and minutes
 *   npm run scout:locate -- --apply --write                  write location, milesFromHome, minutesOut
 *
 * Findings accumulate in scout/data/locations.json, so a run can stop and pick up where it left off.
 * The previous travel values are kept on each place as travelPrevious.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AnyBulkWriteOperation, Document } from "mongodb";
import { z } from "zod";
import { withDb } from "./lib/atlas";
import { parkingNear, routeFromHome, type RouteFacts } from "./lib/enrich";
import { geocode } from "./lib/geocode";
import { APP_HOME, straightMiles } from "./lib/origin";
import { backAt, duskOk } from "./lib/place-doc";
import { readPage, webSearch } from "./lib/tavily";
import { MODEL } from "./graph";

const OUT = join(import.meta.dirname, "data", "locations.json");
const MAX_ITERATIONS = 24;

type Located = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  what: string;
  source: string;
  route: RouteFacts;
  at: string;
};

async function load(): Promise<Record<string, Located>> {
  return existsSync(OUT) ? (JSON.parse(await readFile(OUT, "utf8")) as Record<string, Located>) : {};
}

async function save(all: Record<string, Located>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(OUT, JSON.stringify(sorted, null, 2) + "\n");
}

const SYSTEM = `You pin places to the exact spot a family parks, so drive times from home (${APP_HOME.label}) can be routed.

- The photo description and note say which part of a place the family visits (a beach, an overlook, a trailhead). Pin that spot's parking lot or entrance, not the center of the park or the nearest town.
- geocode gives a first guess and is often a centroid or a namesake elsewhere. parking_near lists mapped lots with coordinates around a point. Confirm the spot with a page you read (the park's map or page, Wikipedia, a government listing).
- Submit a best guess with submit_location as soon as you have a plausible point, then refine; a later submission replaces it. It routes from home and reports the drive, how far the point sits from a road, and parking nearby. If the point is far from a road or the drive looks wrong for the place, refine and resubmit.
- Say in "what" how sure you are when the spot is inferred rather than confirmed.
- Finish with one line naming the spot you pinned.`;

async function locate(client: Anthropic, place: Document): Promise<Located | null> {
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
        console.log(`    ${block.name}  ${shown.length > 120 ? `${shown.slice(0, 120)}…` : shown}`);
      }
    }
  }
  const final = await runner.done();
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
  if (text) console.log(`    → ${text}`);
  return last;
}

function hhmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

async function apply(write: boolean): Promise<void> {
  const found = await load();
  await withDb(async (db) => {
    const places = db.collection("places");
    const docs = await places.find({}, { projection: { embedding: 0 } }).sort({ milesFromHome: 1 }).toArray();
    console.log(`${"place".padEnd(20)} ${"stored".padStart(13)} ${"routed".padStart(13)}  Δmin  home by    snap  spot`);
    const writes: AnyBulkWriteOperation<Document>[] = [];
    for (const doc of docs) {
      const hit = found[String(doc.id)];
      const stored = `${doc.milesFromHome} mi ${doc.minutesOut}m`;
      if (!hit) {
        console.log(`${String(doc.id).padEnd(20)} ${stored.padStart(13)} ${"—".padStart(13)}`);
        continue;
      }
      const miles = Math.round(hit.route.miles);
      const minutes = hit.route.minutes;
      const delta = minutes - Number(doc.minutesOut);
      const before = backAt({ minutesOut: Number(doc.minutesOut), onSiteMinutes: Number(doc.onSiteMinutes) });
      const after = backAt({ minutesOut: minutes, onSiteMinutes: Number(doc.onSiteMinutes) });
      const ok = duskOk({ minutesOut: minutes, onSiteMinutes: Number(doc.onSiteMinutes) });
      console.log(
        `${String(doc.id).padEnd(20)} ${stored.padStart(13)} ${`${miles} mi ${minutes}m`.padStart(13)}  ${`${delta >= 0 ? "+" : ""}${delta}`.padStart(4)}  ${hhmm(before)}→${hhmm(after)}${ok ? "" : "!"}  ${hit.route.snapMiles.toFixed(2).padStart(4)}  ${hit.what}`,
      );
      writes.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              location: { type: "Point", coordinates: [hit.lng, hit.lat] },
              locationWhat: hit.what,
              locationSource: hit.source,
              milesFromHome: miles,
              minutesOut: minutes,
              duskOk: ok,
              travelFrom: { origin: APP_HOME, routedAt: hit.at },
              travelPrevious: { milesFromHome: doc.milesFromHome, minutesOut: doc.minutesOut },
            },
          },
        },
      });
    }
    console.log(`\n${writes.length} of ${docs.length} located. "!" = home after dusk even on the longest Saturday.`);
    if (!write) {
      console.log("dry run. Add --write to update places.");
      return;
    }
    const result = await places.bulkWrite(writes);
    console.log(`updated ${result.modifiedCount} places`);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) return apply(argv.includes("--write"));

  const ids = argv.find((a) => a.startsWith("--ids="))?.slice(6).split(",").filter(Boolean);
  const found = await load();
  const places = await withDb((db) =>
    db
      .collection("places")
      .find(ids ? { id: { $in: ids } } : { location: { $exists: false } }, { projection: { embedding: 0 } })
      .sort({ milesFromHome: 1 })
      .toArray(),
  );
  const todo = ids ? places : places.filter((p) => !found[String(p.id)]);
  console.log(`locating ${todo.length} place(s) with ${MODEL}`);

  const client = new Anthropic();
  for (const place of todo) {
    console.log(`\n${place.id} · ${place.title}`);
    const hit = await locate(client, place);
    if (!hit) {
      console.log("    no location submitted");
      continue;
    }
    found[hit.id] = hit;
    await save(found);
    console.log(`    saved: ${hit.lat}, ${hit.lng} · ${hit.route.miles} mi, ${hit.route.minutes} min (on file ${place.milesFromHome} mi, ${place.minutesOut} min)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
