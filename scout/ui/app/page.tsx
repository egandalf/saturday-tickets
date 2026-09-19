import Link from "next/link";
import { listAgents } from "../../framework/agents";
import type { Execution } from "../../framework/types";
import { AutoRefresh } from "../components/AutoRefresh";
import { getFramework, plain } from "../lib/server";
import { ago } from "../lib/types";

export const dynamic = "force-dynamic";

function label(e: Execution): string {
  const item = (e.input.item as { title?: string } | undefined)?.title;
  if (item) return item;
  if (e.input.title) return String(e.input.title);
  if (e.input.focus) return `focus: ${e.input.focus}`;
  return e.agent;
}

function Row({ e, stalled, depth = 0 }: { e: Execution; stalled: boolean; depth?: number }) {
  return (
    <tr>
      <td style={{ paddingLeft: 10 + depth * 22 }}>
        {depth ? <span className="muted">↳ </span> : null}
        <Link href={`/executions/${e._id}`}>{label(e)}</Link>
      </td>
      <td>
        <span className="chip">
          {e.agent}@{e.version}
        </span>
      </td>
      <td className={`status-${stalled ? "failed" : e.status}`}>
        {stalled ? "stalled" : e.status}
        {e.waiting ? <div className="small">{e.waiting.summary}</div> : null}
        {e.outcome && e.status === "done" ? <div className="small muted">{e.outcome}</div> : null}
        {e.error ? <div className="small error">{e.error.slice(0, 120)}</div> : null}
      </td>
      <td className="small muted">{ago(e.updatedAt)}</td>
    </tr>
  );
}

export default async function InboxPage() {
  const fw = await getFramework();
  const all = plain(await fw.db.collection<Execution>("executions").find().sort({ updatedAt: -1 }).limit(200).toArray());
  const agents = plain(await listAgents(fw.db));
  const stalled = (e: Execution) => ["queued", "running"].includes(e.status) && !fw.inFlight.has(e._id);
  const waiting = all.filter((e) => e.status === "waiting");
  const running = all.filter((e) => ["queued", "running"].includes(e.status));

  // Recent work as trees: roots, each with its children underneath.
  const byParent = new Map<string, Execution[]>();
  for (const e of all) if (e.parentId) byParent.set(e.parentId, [...(byParent.get(e.parentId) ?? []), e]);
  const roots = all.filter((e) => !e.parentId).slice(0, 30);
  const rows = (e: Execution, depth: number): React.ReactNode[] => [
    <Row key={e._id} e={e} stalled={stalled(e)} depth={depth} />,
    ...(byParent.get(e._id) ?? []).flatMap((c) => rows(c, depth + 1)),
  ];

  return (
    <>
      <AutoRefresh active={running.length > 0} />
      <header>
        <p className="kicker">Inbox</p>
        <h1>{waiting.length ? `${waiting.length} waiting on you` : "Nothing waiting on you"}</h1>
        <p className="muted">
          {running.length} running · Start:{" "}
          {agents.map((a, i) => (
            <span key={a.name}>
              {i ? " · " : ""}
              <Link href={`/agents/${a.name}#run`}>{a.name}</Link>
            </span>
          ))}
        </p>
      </header>

      {waiting.length ? (
        <section className="panel">
          <h2>Waiting on you</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {waiting.map((e) => (
                  <Row key={e._id} e={e} stalled={false} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Executions</h2>
        {roots.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>{roots.flatMap((r) => rows(r, 0))}</tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No executions yet. <Link href="/agents/discover#run">Run discover</Link> to find leads.
          </p>
        )}
      </section>
    </>
  );
}
