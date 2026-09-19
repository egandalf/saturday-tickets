import Link from "next/link";
import { listAgents } from "../../../framework/agents";
import { describeTools } from "../../../framework/tools/index";
import { getDb, plain } from "../../lib/server";

export const dynamic = "force-dynamic";

const EFFECT_HELP: Record<string, string> = {
  read: "reads only",
  stage: "writes framework memory",
  write: "changes live data; always pauses for a person",
  output: "ends the agent's work and shapes its stop",
};

export default async function ToolsPage() {
  const agents = plain(await listAgents(await getDb()));
  const usedBy = (name: string) => agents.filter((a) => a.definition.tools.includes(name) || a.definition.output === name).map((a) => a.name);
  const approvedBy = (name: string) => describeTools().filter((t) => t.onApprove === name).map((t) => t.name);
  return (
    <>
      <header>
        <p className="kicker">Tools</p>
        <h1>The tool library</h1>
        <p className="muted">Tools live in code; agents pick them by name. Side effects only happen here.</p>
      </header>
      {describeTools().map((t) => (
        <article key={t.name} id={t.name} className="panel stack">
          <div className="row">
            <h2 className="grow mono">{t.name}</h2>
            <span className={`chip ${t.effect === "write" ? "bad" : t.effect === "output" ? "solar" : t.effect === "stage" ? "good" : ""}`}>
              {t.effect} · {EFFECT_HELP[t.effect]}
            </span>
          </div>
          <p>{t.description}</p>
          <p className="small">
            <span className="muted">Used by:</span>{" "}
            {usedBy(t.name).map((a, i) => (
              <span key={a}>
                {i ? ", " : ""}
                <Link href={`/agents/${a}`}>{a}</Link>
              </span>
            ))}
            {approvedBy(t.name).length ? <span className="muted"> · runs when a person approves {approvedBy(t.name).join(", ")}</span> : null}
            {!usedBy(t.name).length && !approvedBy(t.name).length ? <span className="muted">no agent yet</span> : null}
            {t.review ? <span className="muted"> · stop: {t.review}{t.onApprove ? `, approving runs ${t.onApprove}` : ""}</span> : null}
          </p>
          <details className="small">
            <summary className="muted">Input schema</summary>
            <pre className="mono diff">{JSON.stringify(t.schema, null, 2)}</pre>
          </details>
        </article>
      ))}
    </>
  );
}
