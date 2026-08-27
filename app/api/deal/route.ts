import { dealSaturday } from "@/lib/deal";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  log.line("http.GET", { path: "/api/deal" });
  try {
    const tickets = await dealSaturday();
    log.line("http.GET.ok", { path: "/api/deal", count: tickets.length });
    return Response.json(
      { tickets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("http.GET.fail", err, { path: "/api/deal" });
    return Response.json(
      { tickets: [], error: "deal failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
