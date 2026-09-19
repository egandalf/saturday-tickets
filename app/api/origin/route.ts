import { formatOrigin, isHome, originFromPoint, originFromText } from "@/lib/geo";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?q=Lexington, KY (typed) or ?lat=&lng= (device location) → the origin a deal starts from. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q");
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  try {
    const origin = q !== null ? await originFromText(q) : await originFromPoint(lat, lng);
    log.line("http.GET.origin", { q, from: origin.label, tz: origin.tz });
    return Response.json({ ...origin, param: formatOrigin(origin), home: isHome(origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("http.GET.origin.fail", err, { q });
    return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
