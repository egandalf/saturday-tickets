import { dealSaturday, parseMood } from "@/lib/deal";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyRetrieve = { source: "seed" as const, via: null, operator: "seed" as const, atlas: null, mood: null };

function payload(dealt: Awaited<ReturnType<typeof dealSaturday>>) {
  return {
    tickets: dealt.tickets,
    retrieve: dealt.retrieve,
    calls: dealt.calls,
    threadId: dealt.threadId,
    nodes: dealt.nodes,
  };
}

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
    return Response.json(payload(dealt), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("http.GET.fail", err, { path: "/api/deal" });
    return Response.json(
      { tickets: [], retrieve: emptyRetrieve, calls: [], threadId: "", nodes: [], error: "deal failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  let body: { threadId?: string; note?: string; mood?: string } = {};
  try {
    body = (await request.json()) as { threadId?: string; note?: string; mood?: string };
  } catch {
    log.line("http.POST.badjson", { path: "/api/deal" });
    return Response.json(
      { tickets: [], retrieve: emptyRetrieve, calls: [], threadId: "", nodes: [], error: "bad json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const mood = parseMood(body.mood) ?? parseMood(new URL(request.url).searchParams.get("mood"));
  const threadId = typeof body.threadId === "string" ? body.threadId : undefined;
  const note = typeof body.note === "string" ? body.note : undefined;
  log.line("http.POST", { path: "/api/deal", mood: mood ?? "none", threadId: threadId ?? "new", note: Boolean(note) });
  try {
    const dealt = await dealSaturday(mood, { threadId, note });
    log.line("http.POST.ok", {
      path: "/api/deal",
      count: dealt.tickets.length,
      threadId: dealt.threadId,
      nodes: dealt.nodes,
      ids: dealt.tickets.map((t) => t.id),
    });
    return Response.json(payload(dealt), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("http.POST.fail", err, { path: "/api/deal" });
    return Response.json(
      { tickets: [], retrieve: emptyRetrieve, calls: [], threadId: threadId ?? "", nodes: [], error: "deal failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
