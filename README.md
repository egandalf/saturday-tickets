# saturday-tickets

Thursday-night kitchen tickets: three family Saturday ideas from the driveway at 41144 (Greenup, Kentucky).

Spare-time PoC. Public repo. Separate Vercel project and Blob store from `ky-drivers-exam-game`.

## Stack

- Next.js on Vercel Hobby
- Four TypeScript nodes behind `/api/deal`: notes, retrieve, filter, deal
- MongoDB Atlas M0: `places`, `notes`, `checkpoints`, cached Voyage query embed
- No Voyage spend. Rank inside the signed tag set with the cached family embed. Charge stays off the ticket.

## Card contract

Chips on the ticket: photo, surface (`PAVED` or `PACKED GRAVEL`), daylight (`BACK BEFORE DUSK`), and `WATER CROSSING` when the place has one.

Hard filters, not badges: turnaround, clay-when-wet refuse. Water crossings are established and assessed before scout accepts them; they are dealt unless the family picks **No water crossings** (`?water=avoid`, or `avoidWater` in the POST body). Kind tags are membership only and live in code.

Visual: graphite, chalk type, Solar Yellow `#ffac00` only. No Rivian logo.

## Graph test

1. `GET /api/deal` deals three and returns `threadId`.
2. `POST /api/deal` with `{ "threadId", "note": "swap the middle one for food" }` loads the checkpoint, swaps the middle ticket for the next unused survivor in that tagged set, and writes Atlas `checkpoints` again. Food is not a signed tag, so it does not invent a restaurant.

## Logs

Each deal prints a labeled block to the Vercel runtime log (and the browser console for cards). Lines share an 8-char deal id. Atlas command traffic is pretty-printed JSON. URIs, passwords, API keys, and embeddings are stripped.

## Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set `MONGODB_URI` when Atlas exists.

## Agents (local only)

`scout/framework` is a small agent framework on LangGraph and Atlas, and `scout/ui` is its local UI (`npm run scout:ui`, http://localhost:3100). Neither is part of the Vercel build. Keys come from the repo's `.env.local`: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `ORS_API_KEY`, `VOYAGE_API_KEY`, `BLOB_READ_WRITE_TOKEN`.

- **Tools** live in code (`scout/framework/tools`): web search and page reading (Tavily), geocoding and routing from home (OpenRouteService), parking (Overpass), photos (Wikimedia Commons), memory, and output tools. Each has an effect: `read`, `stage` (framework memory only), `write` (live data; always pauses for a person), or `output` (ends the agent's work and shapes its stop).
- **Agents** are plain-English instructions plus tools picked from the library, stored in Atlas (`agents`, `agent_versions`) and edited in the UI. Every save is a new version; every execution records the version it ran. Seeds: `discover`, `research`, `locate`.
- **Executions** each run on their own LangGraph thread (`agent_checkpoints`), step by step: model turn, tool round, human stop. A run can pause for a person, survive a restart (Continue picks up from the last step), and resume. Children started by a handoff are independent executions.
- **Audit log** (`execution_events`): every model turn with its summarized thinking, text, tool calls and results, memory reads and writes, human decisions, and handoffs, in order, shown as a timeline.
- **Memory** (LangGraph store, `agent_memory`): namespaced facts (`place/<id>`, `lead/<id>`, `agent/<name>/lessons`), each linked to the execution step that wrote it.

The Saturday flow: **discover** proposes leads → you select which to research (HITL) → one **research** execution per lead → you approve or reject each draft (HITL); approving runs `promote_place` (photo to Blob, upsert into `places`, tags added to `lib/places.ts` for you to commit). **locate** pins an existing place where the family parks → you approve the pin → `apply_travel` updates its drive time.

```bash
npm run scout:ui                                          # Inbox, executions, agents, tools, memory, places
npm run agent -- run discover '{"focus":"history","count":4}'
npm run agent -- list | show <id> | stop <id> | decide <id> '<json>' | continue <id>
npm run scout:upsert -- places.json [--write]             # validate, embed, and upsert places by hand
npm run scout:export                                      # snapshot places to scout/data
npm run scout:reembed [-- --write]                        # re-embed every place on the current model
```

The origin and radius bound where discover looks. `milesFromHome` and `minutesOut` are always routed from 41144, so any accepted place can deal when it is in reach before dusk.
