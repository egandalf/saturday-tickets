import { notFound } from "next/navigation";
import { ExecutionView } from "../../../components/ExecutionView";
import { executionView } from "../../../lib/server";

export const dynamic = "force-dynamic";

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await executionView(id);
  if (!view) notFound();
  return <ExecutionView id={id} initial={view} />;
}
