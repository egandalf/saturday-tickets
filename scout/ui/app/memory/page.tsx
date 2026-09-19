import Link from "next/link";
import { recallFrom } from "../../../framework/tools/memory";
import { getFramework, plain } from "../../lib/server";
import { ago } from "../../lib/types";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ ns?: string; q?: string }> }) {
  const { ns = "", q = "" } = await searchParams;
  const fw = await getFramework();
  const namespaces = (await fw.store.listNamespaces({ limit: 1000 })).map((n) => n.join("/")).sort();
  const groups = new Map<string, string[]>();
  for (const n of namespaces) groups.set(n.split("/")[0], [...(groups.get(n.split("/")[0]) ?? []), n]);
  const memories = plain(await recallFrom(fw.store, ns, q || undefined, 200));

  return (
    <>
      <header>
        <p className="kicker">Memory</p>
        <h1>{ns ? ns : "All memories"}</h1>
        <p className="muted">
          What agents and people have recorded, and where it came from. Each memory links to the step in the audit log that wrote it.
        </p>
      </header>
      <form className="panel row">
        <label className="grow">
          Namespace (prefix)
          <input name="ns" defaultValue={ns} placeholder="place, lead/buckeye-furnace, agent/research/lessons" />
        </label>
        <label className="grow">
          Contains
          <input name="q" defaultValue={q} />
        </label>
        <button type="submit">Filter</button>
      </form>
      <div className="card" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 3fr)" }}>
        <nav className="panel small stack">
          <Link href="/memory">all</Link>
          {[...groups.entries()].map(([group, list]) => (
            <details key={group} open={ns.startsWith(group)}>
              <summary>
                <Link href={`/memory?ns=${group}`}>{group}</Link> <span className="muted">({list.length})</span>
              </summary>
              {list.map((n) => (
                <div key={n}>
                  <Link href={`/memory?ns=${encodeURIComponent(n)}`} className={n === ns ? "status-review" : ""}>
                    {n.slice(group.length + 1) || n}
                  </Link>
                </div>
              ))}
            </details>
          ))}
        </nav>
        <section className="panel table-wrap">
          {memories.length ? (
            <table>
              <thead>
                <tr>
                  <th>Memory</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {memories.map((m) => (
                  <tr key={`${m.namespace}:${m.key}`}>
                    <td>
                      <div className="small muted mono">
                        {m.namespace}:{m.key} · {m.kind}
                      </div>
                      <div>{m.text}</div>
                      {m.source ? (
                        <div className="small muted mono">
                          {/^https?:/.test(m.source) ? (
                            <a href={m.source} target="_blank" rel="noreferrer">
                              {m.source}
                            </a>
                          ) : (
                            m.source
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="small">
                      <Link href={`/executions/${m.executionId}#s${m.step}`}>
                        {m.agent} · step {m.step}
                      </Link>
                      <div className="muted">{ago(m.at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No memories here yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
