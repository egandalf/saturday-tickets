import Link from "next/link";
import { listAgents } from "../../../../framework/agents";
import { describeTools } from "../../../../framework/tools/index";
import type { AgentDefinition } from "../../../../framework/types";
import { AgentEditor } from "../../../components/AgentEditor";
import { getDb, plain } from "../../../lib/server";

export const dynamic = "force-dynamic";

const BLANK: AgentDefinition = {
  name: "",
  description: "",
  model: "claude-sonnet-5",
  effort: "high",
  maxTurns: 30,
  instructions: "",
  tools: ["recall", "remember", "web_search", "read_page"],
  output: "propose_leads",
  input: [{ name: "focus", label: "Focus", type: "string" }],
  recall: [],
};

export default async function NewAgentPage() {
  const agents = plain(await listAgents(await getDb())).map((a) => a.name);
  return (
    <>
      <header>
        <p className="kicker">
          <Link href="/agents">Agents</Link> · new
        </p>
        <h1>New agent</h1>
        <p className="muted">Describe the job in plain English, pick its tools from the library, and choose how it finishes. A person reviews its output at the stop.</p>
      </header>
      <AgentEditor definition={BLANK} version={0} tools={describeTools()} agents={agents} isNew />
    </>
  );
}
