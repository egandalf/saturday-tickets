import { getDb, locating, plain } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const lines = await db
    .collection("scout_events")
    .find({ threadId: "locate" }, { projection: { _id: 0 } })
    .sort({ _id: -1 })
    .limit(80)
    .toArray();
  return Response.json(plain({ active: locating.active, events: lines.reverse() }), { headers: { "Cache-Control": "no-store" } });
}
