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

## Scout (local only)

`scout/` finds new places with a LangGraph graph and never deploys (the Next build excludes it). Claude Sonnet 5 researches with Tavily; a person reviews every candidate in the terminal before anything is kept. Needs `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` in `.env.local`.

```bash
npm run scout -- --focus=history --count=3          # thinnest kind when --focus is omitted
npm run scout -- --origin=35.59,-82.55,"Asheville NC" --radius=50   # scout from somewhere else
npm run scout -- --thread=<id>                      # resume a run paused at review
npm run scout:upsert -- places.json [--write]       # validate, embed, and upsert places
npm run scout:export                                # snapshot places to scout/data
npm run scout:reembed [-- --write]                  # re-embed every place on the current model
```

Graph: `gap` (thinnest kind, known places) → `discover` (web search, read page, `submit_candidate`) → `review` (one interrupt per candidate) → `stage`. Decisions land in Atlas `candidates`; rejected ones stay so later runs skip them. Run state lives in `scout_checkpoints` and `scout_checkpoint_writes`, apart from the app's `checkpoints`.

The origin and radius bound where a run looks. `milesFromHome` and `minutesOut` are always from 41144, so any accepted place can deal when it is in reach before dusk.
