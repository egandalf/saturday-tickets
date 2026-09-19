import { runView } from "../../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ thread: string }> }) {
  const { thread } = await params;
  const view = await runView(thread);
  if (!view) return Response.json({ error: "no such run" }, { status: 404 });
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
}
