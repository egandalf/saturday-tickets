import { notFound } from "next/navigation";
import { RunView } from "../../../components/RunView";
import { runView } from "../../../lib/server";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ thread: string }> }) {
  const { thread } = await params;
  const view = await runView(thread);
  if (!view) notFound();
  return <RunView threadId={thread} initial={view} />;
}
