"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cancelAction, continueAction, decideAction } from "../app/actions";
import { costOf, type Decision, type ExecutionView as View, type Leads, type LocatedPin, type PlaceDraft } from "../lib/types";
import { PinApprovePanel } from "./panels/PinApprovePanel";
import { PlaceApprovePanel } from "./panels/PlaceApprovePanel";
import { SelectPanel } from "./panels/SelectPanel";
import { ToolApprovePanel } from "./panels/ToolApprovePanel";
import { Timeline } from "./Timeline";

const POLL_MS = 2000;

export function ExecutionView({ id, initial }: { id: string; initial: View }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execution: e, events, children, parent, stop, stalled } = view;
  const live = ["queued", "running"].includes(e.status) && !stalled;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/executions/${id}`, { cache: "no-store" });
    if (res.ok) setView((await res.json()) as View);
  }, [id]);

  useEffect(() => {
    if (!live && !busy) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, busy, refresh]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await fn();
    if (!result.ok) setError(result.error ?? "failed");
    await refresh();
    setBusy(false);
  }
  const decide = (d: Decision) => act(() => decideAction(id, d));

  const usage = events.filter((ev) => ev.type === "llm_call").map((ev) => ev.data.usage as Parameters<typeof costOf>[0]);
  const cost = usage.reduce((n, u) => n + costOf(u), 0);
  const turns = usage.length;
  const tools = events.filter((ev) => ev.type === "tool_call").length;

  return (
    <>
      <header className="stack">
        <p className="kicker">
          <Link href="/">Inbox</Link> · execution {id.slice(0, 8)}
          {parent ? (
            <>
              {" "}
              · from <Link href={`/executions/${parent._id}`}>{parent.agent} {parent._id.slice(0, 8)}</Link>
            </>
          ) : null}
        </p>
        <h1>
          {(e.input.item as { title?: string } | undefined)?.title ?? (e.input.title as string | undefined) ?? e.agent}
        </h1>
        <div className="row">
          <Link className="chip" href={`/agents/${e.agent}?v=${e.version}`}>
            {e.agent}@{e.version}
          </Link>
          <span className={`status-${stalled ? "failed" : e.status}`}>{stalled ? "stalled" : e.status}</span>
          {e.waiting ? <span className="status-review">{e.waiting.summary}</span> : null}
          {e.outcome ? <span className="muted">{e.outcome}</span> : null}
          <span className="muted small">
            {turns} model turns · {tools} tool calls · ${cost.toFixed(3)}
          </span>
          <span className="grow" />
          {stalled || e.status === "failed" ? (
            <button type="button" disabled={busy} onClick={() => act(() => continueAction(id))}>
              Continue from last step
            </button>
          ) : null}
          {["queued", "running", "waiting"].includes(e.status) ? (
            <button type="button" className="danger" disabled={busy} onClick={() => act(() => cancelAction(id))}>
              Cancel
            </button>
          ) : null}
        </div>
        {e.error ? <p className="error">{e.error.slice(0, 400)}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <details className="small">
          <summary className="muted">Input</summary>
          <pre className="mono diff">{JSON.stringify(e.input, null, 2)}</pre>
        </details>
      </header>

      {e.status === "waiting" && stop ? (
        <section className="panel stack decided">
          <p className="kicker">Your decision</p>
          {stop.error ? <p className="error">Last attempt failed: {stop.error}</p> : null}
          {stop.kind === "select" ? <SelectPanel leads={stop.output as Leads} busy={busy} onDecide={decide} /> : null}
          {stop.kind === "approve" && stop.agent !== "locate" && (stop.output as PlaceDraft)?.draft ? (
            <PlaceApprovePanel out={stop.output as PlaceDraft} busy={busy} onDecide={decide} />
          ) : null}
          {stop.kind === "approve" && (stop.output as LocatedPin)?.placeId ? (
            <PinApprovePanel pin={stop.output as LocatedPin} busy={busy} onDecide={decide} />
          ) : null}
          {stop.kind === "approve_tool" ? <ToolApprovePanel calls={stop.calls ?? []} busy={busy} onDecide={decide} /> : null}
        </section>
      ) : null}

      {view.result ? (
        <section className="panel stack">
          <p className="kicker">Result</p>
          {typeof (view.result as { diff?: string }).diff === "string" ? (
            <pre className="diff mono">
              {(view.result as { diff: string }).diff.split("\n").map((line, i) => (
                <div key={i} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : ""}>
                  {line || " "}
                </div>
              ))}
            </pre>
          ) : null}
          <pre className="mono small diff">{JSON.stringify({ ...(view.result as object), diff: undefined }, null, 2)}</pre>
        </section>
      ) : null}

      {children.length ? (
        <section className="panel">
          <p className="kicker">Handed off</p>
          {children.map((c) => (
            <div key={c._id} className="row small">
              <Link href={`/executions/${c._id}`}>{(c.input.item as { title?: string } | undefined)?.title ?? c._id.slice(0, 8)}</Link>
              <span className={`status-${c.status}`}>{c.status}</span>
              {c.waiting ? <span className="muted">{c.waiting.summary}</span> : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <p className="kicker">Audit log · {events.length} events</p>
        <Timeline events={events} live={live} />
      </section>
    </>
  );
}
