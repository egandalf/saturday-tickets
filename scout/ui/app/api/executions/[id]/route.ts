import { executionView } from "../../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await executionView(id);
  if (!view) return Response.json({ error: "no such execution" }, { status: 404 });
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
}
