# saturday-tickets

Thursday-night kitchen tickets: three family Saturday ideas from the driveway at 41144 (Greenup, Kentucky).

Spare-time PoC. Public repo. Separate Vercel project and Blob store from `ky-drivers-exam-game`.

## Stack

- Next.js on Vercel Hobby
- Python LangGraph (four nodes) later, not in this shell
- MongoDB Atlas M0: `places`, `notes`, LangGraph checkpointer

## Card contract

Chips on the ticket: photo, surface (`PAVED` or `PACKED GRAVEL`), daylight (`BACK BEFORE DUSK`).

Hard filters, not badges: turnaround, no water crossing, clay-when-wet refuse.

Visual: graphite, chalk type, Solar Yellow `#ffac00` only. No Rivian logo.

## Logs

Each deal prints a labeled block to the Vercel runtime log (and the browser console for cards). Lines share an 8-char deal id. Atlas command traffic is pretty-printed JSON. URIs, passwords, API keys, and embeddings are stripped.

## Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set `MONGODB_URI` when Atlas exists.
