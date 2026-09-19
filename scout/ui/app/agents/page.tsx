import Link from "next/link";
import { listAgents } from "../../../framework/agents";
import { getDb, plain } from "../../lib/server";
import { ago } from "../../lib/types";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const db = await getDb();
  const agents = plain(await listAgents(db));
  const counts = new Map(
    (await db.collection("executions").aggregate<{ _id: string; n: number }>([{ $group: { _id: "$agent", n: { $sum: 1 } } }]).toArray()).map((c) => [c._id, c.n]),
  );
  return (
    <>
      <header className="row">
        <div className="grow">
          <p className="kicker">Agents</p>
          <h1>Plain-English agents, tools from the library</h1>
          <p className="muted">Each edit saves a new version; every execution records the version it ran.</p>
        </div>
        <Link className="button" href="/agents/new">
          New agent
        </Link>
      </header>
      {agents.map((a) => (
        <article key={a.name} className="panel stack">
          <div className="row">
            <h2 className="grow">
              <Link href={`/agents/${a.name}`}>{a.name}</Link> <span className="muted small">v{a.version}</span>
            </h2>
            <span className="small muted">
              {counts.get(a.name) ?? 0} executions · edited {ago(a.createdAt)}
            </span>
            <Link className="button" href={`/agents/${a.name}#run`}>
              Run
            </Link>
          </div>
          <p>{a.definition.description}</p>
          <p className="small">
            <span className="muted">Tools:</span> {a.definition.tools.join(", ")} · <span className="muted">finishes with</span>{" "}
            <strong>{a.definition.output}</strong>
            {a.definition.handoff ? (
              <>
                {" "}
                · <span className="muted">hands chosen items to</span> <strong>{a.definition.handoff}</strong>
              </>
            ) : null}
          </p>
        </article>
      ))}
    </>
  );
}
