# saturday-tickets

Thursday-night kitchen tickets: three family Saturday ideas from the driveway at 41144 (Greenup, Kentucky).

Spare-time PoC. Public repo. Separate Vercel project and Blob store from `ky-drivers-exam-game`.

## Stack

- Next.js on Vercel Hobby
- Four TypeScript nodes behind `/api/deal`: notes, retrieve, filter, deal
- MongoDB Atlas M0: `places`, `notes`, `checkpoints`, cached Voyage query embed
- No Voyage spend. Rank inside the signed tag set with the cached family embed. Charge stays off the ticket.

## Card contract

Chips on the ticket: photo, surface (`PAVED` or `PACKED GRAVEL`), daylight (`BACK BEFORE DUSK`).

Hard filters, not badges: turnaround, no water crossing, clay-when-wet refuse. Kind tags are membership only and live in code.

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
