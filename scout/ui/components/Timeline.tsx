"use client";

import Link from "next/link";
import { Fragment } from "react";
import { costOf, type ExecutionEvent } from "../lib/types";

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function clip(text: string, n = 160): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function Event({ ev }: { ev: ExecutionEvent }) {
  const d = ev.data as Record<string, any>;
  switch (ev.type) {
    case "start":
      return (
        <div className="ev ev-start">
          Started <strong>{d.agent}@{d.version}</strong>
        </div>
      );
    case "memory_read":
      return (
        <div className="ev ev-memory">
          Recalled <Link href={`/memory?ns=${encodeURIComponent(d.namespace)}`}>{d.namespace}</Link>
          {d.contains ? ` matching “${d.contains}”` : ""}: {d.keys?.length ?? 0} memor{d.keys?.length === 1 ? "y" : "ies"}
          {d.auto ? <span className="muted"> (automatic)</span> : null}
        </div>
      );
    case "memory_write":
      return (
        <div className="ev ev-memory">
          Remembered <Link href={`/memory?ns=${encodeURIComponent(d.namespace)}`}>{d.namespace}</Link>:{d.key} · {d.text}
          {d.source ? (
            <span className="muted">
              {" "}
              (<span className="mono">{clip(String(d.source), 80)}</span>)
            </span>
          ) : null}
        </div>
      );
    case "llm_call":
      return (
        <div className="ev ev-llm small muted">
          Claude {d.model} · {d.effort} · {(d.ms / 1000).toFixed(1)}s · {d.stopReason} · in {d.usage?.input_tokens ?? 0} + cache write{" "}
          {d.usage?.cache_creation_input_tokens ?? 0} / read {d.usage?.cache_read_input_tokens ?? 0} · out {d.usage?.output_tokens ?? 0} · $
          {costOf(d.usage ?? {}).toFixed(4)}
        </div>
      );
    case "thinking":
      return (
        <div className="ev ev-thinking">
          <span className="kicker">Thinking</span>
          <p>{d.text}</p>
        </div>
      );
    case "text":
      return (
        <div className="ev ev-text">
          <p>{d.text}</p>
        </div>
      );
    case "tool_call":
      return (
        <details className="ev ev-tool">
          <summary>
            → <strong>{d.name}</strong> <span className="mono small muted">{clip(JSON.stringify(d.input), 120)}</span>
            {d.by === "person" ? <span className="chip solar"> approved by you</span> : null}
          </summary>
          <pre className="mono small diff">{pretty(d.input)}</pre>
        </details>
      );
    case "tool_result":
      return (
        <details className={`ev ev-result ${d.isError ? "error" : ""}`}>
          <summary>
            ← {d.name}
            {d.ms !== undefined ? <span className="muted small"> {d.ms}ms</span> : null} ·{" "}
            <span className="mono small">{clip(String(d.content), 140)}</span>
          </summary>
          <pre className="mono small diff">{pretty(d.content)}</pre>
        </details>
      );
    case "output":
      return (
        <details className="ev ev-output">
          <summary>
            Submitted <strong>{d.tool}</strong> for review
          </summary>
          <pre className="mono small diff">{pretty(d.output)}</pre>
        </details>
      );
    case "nudge":
      return <div className="ev muted">Nudged: {d.text}</div>;
    case "interrupt":
      return <div className="ev ev-stop">⏸ Paused for a person: {d.summary}</div>;
    case "human":
      return (
        <details className="ev ev-stop">
          <summary>👤 Person decided: {d.decision?.kind === "select" ? `${d.decision.selected.length} selected, ${d.decision.rejected.length} passed over` : d.decision?.approve === false ? `rejected (${d.decision.reason})` : d.decision?.kind === "approve_tool" ? `approved ${d.decision.approved.length} call(s)` : "approved"}</summary>
          <pre className="mono small diff">{pretty(d.decision)}</pre>
        </details>
      );
    case "handoff":
      return (
        <div className="ev ev-stop">
          Handed to <strong>{d.agent}</strong>:{" "}
          {(d.children as { id: string; itemId: string }[]).map((c, i) => (
            <Fragment key={c.id}>
              {i ? ", " : ""}
              <Link href={`/executions/${c.id}`}>{c.itemId}</Link>
            </Fragment>
          ))}
        </div>
      );
    case "error":
      return <div className="ev error">Error: {String(d.reason).slice(0, 600)}</div>;
    case "end":
      return <div className="ev ev-start">Finished: {d.outcome}</div>;
    default:
      return <div className="ev mono small">{ev.type} {JSON.stringify(d)}</div>;
  }
}

export function Timeline({ events, live }: { events: ExecutionEvent[]; live: boolean }) {
  const steps: ExecutionEvent[][] = [];
  for (const ev of events) {
    const last = steps.at(-1);
    if (last && last[0].step === ev.step) last.push(ev);
    else steps.push([ev]);
  }
  return (
    <ol className="timeline">
      {steps.map((group) => (
        <li key={group[0].step} id={`s${group[0].step}`} className="step">
          <span className="step-no mono small muted">{group[0].step}</span>
          <div className="stack">
            {group.map((ev) => (
              <Event key={ev._id} ev={ev} />
            ))}
          </div>
        </li>
      ))}
      {live ? <li className="step status-running">…working</li> : null}
    </ol>
  );
}
