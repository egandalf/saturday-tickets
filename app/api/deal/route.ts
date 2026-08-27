import { dealSaturday, parseMood } from "@/lib/deal";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    });
    return Response.json(
      { tickets: dealt.tickets, retrieve: dealt.retrieve, calls: dealt.calls },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("http.GET.fail", err, { path: "/api/deal" });
    return Response.json(
      {
        tickets: [],
        retrieve: { source: "seed", via: null, operator: "seed", atlas: null, mood: null },
        calls: [],
        error: "deal failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
