import Link from "next/link";
import { notFound } from "next/navigation";
import { listAgents, versionsOf } from "../../../../framework/agents";
import { describeTools } from "../../../../framework/tools/index";
import type { Execution } from "../../../../framework/types";
import { runAgentAction } from "../../actions";
import { AgentEditor } from "../../../components/AgentEditor";
import { definitionText, lineDiff } from "../../../lib/diff";
import { getDb, plain } from "../../../lib/server";
import { ago, FIELD_PREFIX } from "../../../lib/types";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ v?: string }> }) {
  const { name } = await params;
  const { v } = await searchParams;
  const db = await getDb();
  const versions = plain(await versionsOf(db, name));
  if (!versions.length) notFound();
  const current = versions[0];
  const shown = versions.find((x) => String(x.version) === v) ?? current;
  const previous = versions.find((x) => x.version === shown.version - 1);
  const diff = previous ? lineDiff(definitionText(previous.definition), definitionText(shown.definition)) : null;
  const agents = plain(await listAgents(db)).map((a) => a.name);
  const recent = plain(await db.collection<Execution>("executions").find({ agent: name }).sort({ createdAt: -1 }).limit(8).toArray());
  const def = current.definition;

  return (
    <>
      <header>
        <p className="kicker">
          <Link href="/agents">Agents</Link> · {name}
        </p>
        <h1>{name}</h1>
        <p className="muted">{def.description}</p>
      </header>

      <form id="run" action={runAgentAction.bind(null, name)} className="panel stack">
        <h2>Run {name}</h2>
        <div className="row">
          {def.input.map((f) => (
            <label key={f.name} className={f.type === "text" || f.type === "json" ? "grow" : ""} style={f.type === "text" || f.type === "json" ? { flexBasis: "100%" } : undefined}>
              {f.label}
              {f.required ? " *" : ""}
              {f.type === "text" || f.type === "json" ? (
                <textarea name={`${FIELD_PREFIX}${f.name}`} rows={f.type === "json" ? 6 : 3} className={f.type === "json" ? "mono small" : ""} required={f.required} />
              ) : (
                <input name={`${FIELD_PREFIX}${f.name}`} type={f.type === "number" ? "number" : "text"} defaultValue={f.default === undefined ? "" : String(f.default)} required={f.required} />
              )}
              {f.help ? <span className="small muted">{f.help}</span> : null}
            </label>
          ))}
        </div>
        <div className="row">
          <button className="primary" type="submit">
            Start execution
          </button>
          <span className="small muted">
            Runs v{current.version} with {def.model} at {def.effort} effort, up to {def.maxTurns} turns.
          </span>
        </div>
      </form>

      <AgentEditor definition={def} version={current.version} tools={describeTools()} agents={agents} isNew={false} />

      <section className="panel stack">
        <h2>Versions</h2>
        <div className="row small">
          {versions.map((x) => (
            <Link key={x._id} href={`/agents/${name}?v=${x.version}`} className={`chip ${x.version === shown.version ? "solar" : ""}`}>
              v{x.version} · {x.note} · {ago(x.createdAt)}
            </Link>
          ))}
        </div>
        {diff ? (
          <>
            <p className="small muted">
              v{previous!.version} → v{shown.version}
            </p>
            <pre className="diff mono small">
              {diff.map((d, i) => (
                <div key={i} className={d.kind === "add" ? "add" : d.kind === "del" ? "del" : "muted"}>
                  {d.kind === "add" ? "+ " : d.kind === "del" ? "- " : "  "}
                  {d.text || " "}
                </div>
              ))}
            </pre>
          </>
        ) : (
          <p className="small muted">v{shown.version} is the first version.</p>
        )}
      </section>

      <section className="panel">
        <h2>Recent executions</h2>
        {recent.map((e) => (
          <div key={e._id} className="row small">
            <Link href={`/executions/${e._id}`}>{e._id.slice(0, 8)}</Link>
            <span className="chip">v{e.version}</span>
            <span className={`status-${e.status}`}>{e.status}</span>
            <span className="muted">{e.waiting?.summary ?? e.outcome ?? e.error?.slice(0, 80) ?? ""}</span>
            <span className="muted">{ago(e.updatedAt)}</span>
          </div>
        ))}
      </section>
    </>
  );
}
