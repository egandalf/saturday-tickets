# saturday-tickets

Thursday-night kitchen tickets: three family Saturday ideas, from the driveway at 41144 (Greenup, Kentucky) or wherever the family starts.

Spare-time PoC. Public repo. Separate Vercel project and Blob store from `ky-drivers-exam-game`. Live at https://saturday-tickets.vercel.app.

## Stack

- Next.js 15 on Vercel Hobby
- MongoDB Atlas M0, with Atlas Vector Search (`places_vector`, 512 dims)
- Voyage `voyage-3.5-lite` at 512 dims for place and query embeds; the family query embed is cached, so a deal costs no Voyage calls
- Gemini Flash-Lite picks three from the survivors (optional; without `GEMINI_API_KEY` the deal takes the top three in rank order)
- OpenRouteService for drive times and geocoding when the family deals from somewhere other than home
- Photos in Vercel Blob (`photos/<id>.jpg`)

## The deal

Five TypeScript steps behind `/api/deal`: **notes**, **retrieve** (vector search over every place), **travel** (drive times from the origin), **filter** (reach, hard filters, mood, water), **deal** (three tickets). Each deal writes a checkpoint, so Skip and Change this deal revise the same deal from the same origin.

Where from: home by default. **Change** under the headline takes a town, ZIP, or address, or the device's location, and a radius (60, 90, 150, or 200 mi), remembered in a cookie.
- From home, drive times are each place's stored `milesFromHome` / `minutesOut`.
- From anywhere else, each place's `location` is routed with one OpenRouteService matrix call per deal, cached in Atlas `travel_cache` for 30 days. If ORS is down, the ticket shows an estimate marked "(est.)".
- The radius applies to road miles. Dusk and leave-by use that Saturday's sunset in the origin's time zone.
- Places without a `location` deal only from home. Pin them with the locate agent.

## Card contract

Chips on the ticket: photo, surface (`PAVED` or `PACKED GRAVEL`), daylight (`BACK BEFORE DUSK`), and `WATER CROSSING` when the place has one.

Hard filters, not badges: turnaround, clay-when-wet refuse, home before dusk leaving at 10, within the radius. Water crossings are established and assessed before a place is accepted; they are dealt unless the family picks **No water crossings**.

Kind tags (lake, woods, town, history) are membership only and live in code, in `lib/places.ts`. Approving a place in scout adds its tags there; they reach the site when that change is committed and deployed.

Visual: graphite, chalk type, Solar Yellow `#ffac00` only. No Rivian logo.

## API

- `GET /api/deal?mood=&water=avoid&from=lat,lng,Label&radius=` deals three and returns `tickets`, `threadId`, `origin`, `radiusMiles`, and the call trace. Every parameter is optional.
- `POST /api/deal` with `{ "threadId", "slot": 0-2 }` skips a ticket, or `{ "threadId", "note": "swap the middle one" }` revises from the checkpoint. Also takes `mood`, `avoidWater`, `from`, `radius`. Food is not a signed tag, so a note asking for food doesn't invent a restaurant.
- `GET /api/origin?q=Lexington, KY` or `?lat=&lng=` returns an origin (`label`, `lat`, `lng`, `tz`, `param`, `home`). The home ZIP maps to home exactly.

## Data (Atlas)

- `places`: title, surface, `location` (GeoJSON), `milesFromHome` / `minutesOut` (from home), on-site minutes, turnaround, water crossing (with its assessment), clay-when-wet, photo, credit, note, embedding
- `notes`, `checkpoints`: deal notes and deal state
- `query_embeds`, `travel_cache`: cached query embed and routed drive times
- The agents below add their own collections (`agents`, `executions`, `agent_memory`, and others); the app doesn't read them.

## Logs

Each deal prints a labeled block to the Vercel runtime log (and the browser console for cards). Lines share an 8-char deal id; systems are colored (ATLAS, VOYAGE, ORS, GEMINI, FILTER, DEAL). Atlas command traffic is pretty-printed JSON. URIs, passwords, API keys, and embeddings are stripped.

## Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`. The app needs `MONGODB_URI`, `VOYAGE_API_KEY`, and `ORS_API_KEY`; `GEMINI_API_KEY` is optional. The rest of `.env.example` is for the local agents.

## Deploy

Vercel builds `main`. Project env: `MONGODB_URI`, `VOYAGE_API_KEY`, `ORS_API_KEY`, `GEMINI_API_KEY`, all server-only (never `NEXT_PUBLIC_`). After changing the embedding model, run `npm run scout:reembed -- --write` once the deploy is live, so places and queries share a model.

## Agents (local only)

`scout/framework` is a small agent framework on LangGraph and Atlas, and `scout/ui` is its local UI (`npm run scout:ui`, http://localhost:3100). Neither is part of the Vercel build. Keys come from the repo's `.env.local`: the app's, plus `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, and `BLOB_READ_WRITE_TOKEN`. Agents run on Claude Sonnet 5 through the Anthropic SDK.

- **Tools** live in code (`scout/framework/tools`): web search and page reading (Tavily), geocoding, routing, and drive times (OpenRouteService), parking (Overpass), photos near a point or by name (Wikimedia Commons), what's already known, memory, and output tools. Each has an effect: `read`, `stage` (framework memory only), `write` (live data; always pauses for a person), or `output` (ends the agent's work and shapes its stop).
- **Agents** are plain-English instructions plus tools picked from the library, stored in Atlas (`agents`, `agent_versions`) and edited in the UI. Every save is a new version; every execution records the version it ran. Inputs are checked before a run starts; `place` inputs take a ZIP, town, address, or lat,lng. Seeds: `discover`, `research`, `locate`.
- **Executions** each run on their own LangGraph thread (`agent_checkpoints`), step by step: model turn, tool round, human stop. A run can pause for a person, survive a restart (Continue picks up from the last step), and resume. Children started by a handoff are independent executions. A run that repeats the same tool error three times stops instead of looping.
- **Audit log** (`execution_events`): every model turn with its summarized thinking, text, tool calls and results, memory reads and writes, human decisions, and handoffs, in order, shown as a timeline.
- **Memory** (LangGraph store, `agent_memory`): namespaced facts (`place/<id>`, `lead/<id>`, `agent/<name>/lessons`), each linked to the execution step that wrote it.

The Saturday flow: **discover** proposes leads around an origin → you select which to research → one **research** execution per lead → you approve or reject each draft. Approving runs `promote_place`: photo to Blob, upsert into `places` (with its location and drive time from home), and tags added to `lib/places.ts` for you to commit. **locate** pins an existing place where the family parks → you approve the pin → `apply_travel` updates its location and drive time. Discover's origin and radius only bound where it looks; the site deals from wherever the family picks.

```bash
npm run scout:ui                                          # Inbox, executions, agents, tools, memory, places
npm run agent -- run discover '{"focus":"history","count":4,"origin":"Lexington, KY"}'
npm run agent -- list | show <id> | stop <id> | decide <id> '<json>' | continue <id>
npm run scout:upsert -- places.json [--write]             # validate, embed, and upsert places by hand
npm run scout:export                                      # snapshot places to scout/data
npm run scout:reembed [-- --write]                        # re-embed every place on the current model
```
