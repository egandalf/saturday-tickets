import { dealSaturday } from "@/lib/deal";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  log.line("http.GET", { path: "/api/deal" });
  try {
    const dealt = await dealSaturday();
    log.line("http.GET.ok", {
      path: "/api/deal",
      count: dealt.tickets.length,
      source: dealt.retrieve.source,
      via: dealt.retrieve.via,
      operator: dealt.retrieve.operator,
    });
    return Response.json(
      { tickets: dealt.tickets, retrieve: dealt.retrieve },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("http.GET.fail", err, { path: "/api/deal" });
    return Response.json(
      {
        tickets: [],
        retrieve: { source: "seed", via: null, operator: "seed" },
        error: "deal failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
