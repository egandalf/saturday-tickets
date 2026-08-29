import { dealSaturday, parseMood, type DealResult } from "@/lib/deal";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asBodyString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asSlot(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2) {
    return value;
  }
  if (typeof value === "string" && /^(0|1|2)$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function dealPayload(dealt: DealResult) {
  return {
    tickets: dealt.tickets,
    retrieve: dealt.retrieve,
    calls: dealt.calls,
    threadId: dealt.threadId,
    nodes: dealt.nodes,
  };
}

const FAIL_RETRIEVE = { source: "seed", via: null, operator: "seed", atlas: null, mood: null } as const;

export async function GET(request: Request) {
  const mood = parseMood(new URL(request.url).searchParams.get("mood"));
  log.line("http.GET", { path: "/api/deal", mood: mood ?? "none" });
  try {
    const dealt = await dealSaturday(mood);
    log.line("http.GET.ok", {
      path: "/api/deal",
      count: dealt.tickets.length,
      source: dealt.retrieve.source,
      via: dealt.retrieve.via,
      operator: dealt.retrieve.operator,
      mood: dealt.retrieve.mood,
      atlas: dealt.retrieve.atlas,
      threadId: dealt.threadId,
    });
    return Response.json(dealPayload(dealt), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("http.GET.fail", err, { path: "/api/deal" });
    return Response.json(
      {
        tickets: [],
        retrieve: FAIL_RETRIEVE,
        calls: [],
        threadId: "",
        nodes: [],
        error: "deal failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const queryMood = new URL(request.url).searchParams.get("mood");
  log.line("http.POST", { path: "/api/deal" });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { tickets: [], error: "bad json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { tickets: [], error: "bad json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rec = body as Record<string, unknown>;
  const mood = parseMood(asBodyString(rec.mood) ?? queryMood);
  const threadId = asBodyString(rec.threadId);
  const note = asBodyString(rec.note);
  const slot = asSlot(rec.slot);
  log.line("http.POST.body", {
    path: "/api/deal",
    mood: mood ?? "none",
    threadId: threadId ?? null,
    slot: slot ?? null,
    note: note ? note.trim() : null,
  });
  try {
    const dealt = await dealSaturday(mood, { threadId, note, slot });
    log.line("http.POST.ok", {
      path: "/api/deal",
      count: dealt.tickets.length,
      source: dealt.retrieve.source,
      via: dealt.retrieve.via,
      operator: dealt.retrieve.operator,
      mood: dealt.retrieve.mood,
      atlas: dealt.retrieve.atlas,
      threadId: dealt.threadId,
      nodes: dealt.nodes,
    });
    return Response.json(dealPayload(dealt), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("http.POST.fail", err, { path: "/api/deal" });
    return Response.json(
      {
        tickets: [],
        retrieve: FAIL_RETRIEVE,
        calls: [],
        threadId: "",
        nodes: [],
        error: "deal failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
