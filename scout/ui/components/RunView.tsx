"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { finishReviewAction, saveDraftAction } from "../app/actions";
import type { Decision, RunView as View } from "../lib/types";
import { CandidateCard } from "./CandidateCard";

const POLL_MS = 2000;

export function RunView({ threadId, initial }: { threadId: string; initial: View }) {
  const [view, setView] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Decision>>(initial.run.drafts ?? {});
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const status = view.run.status;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${threadId}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as View;
    setView(next);
    setDrafts((current) => ({ ...(next.run.drafts ?? {}), ...current }));
  }, [threadId]);

  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.events.length]);

  async function decide(candidateId: string, decision: Decision | null) {
    setError(null);
    setDrafts((current) => {
      const next = { ...current };
      if (decision) next[candidateId] = decision;
      else delete next[candidateId];
      return next;
    });
    const result = await saveDraftAction(threadId, candidateId, decision);
    if (!result.ok) setError(result.error);
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    const result = await finishReviewAction(threadId);
    if (!result.ok) setError(result.error);
    await refresh();
    setFinishing(false);
  }

  const { run, events, cards } = view;
  const decided = cards.filter((c) => drafts[c.request.candidate.id]).length;
  const accepted = cards.filter((c) => drafts[c.request.candidate.id]?.decision === "accept").length;

  return (
    <>
      <header>
        <p className="kicker">
          <Link href="/">Runs</Link> · {new Date(run.startedAt).toLocaleString()}
        </p>
        <h1>{run.params.focus ? `Scouting: ${run.params.focus}` : "Scouting the thinnest kind"}</h1>
        <p className="muted">
          {run.params.count} wanted · {run.params.run.origin.label} within {run.params.run.radiusMiles} mi ·{" "}
          <span className={`status-${status}`}>{status === "review" ? "ready to review" : status}</span>
          {run.candidates !== undefined ? ` · ${run.candidates} found` : ""}
        </p>
        {run.error ? <p className="error">{run.error}</p> : null}
      </header>

      <details open={status === "running"} className="panel">
        <summary className="kicker" style={{ cursor: "pointer" }}>
          Agent log ({events.length})
        </summary>
        <div className="log mono" ref={logRef}>
          {events.length ? events.map((e, i) => <div key={i}>{e.line}</div>) : <span className="muted">Starting…</span>}
          {status === "running" ? <div className="status-running">…working</div> : null}
        </div>
      </details>

      {status === "review" ? (
        <>
          {cards.map((card) => (
            <CandidateCard
              key={card.request.candidate.id}
              card={card}
              draft={drafts[card.request.candidate.id]}
              onDecide={(d) => decide(card.request.candidate.id, d)}
            />
          ))}
          <div className="sticky-bar row">
            <span className="grow">
              {decided} of {cards.length} decided · {accepted} to accept
            </span>
            {error ? <span className="error">{error}</span> : null}
            <button className="primary" disabled={decided < cards.length || finishing} onClick={finish}>
              {finishing ? "Saving…" : "Finish review"}
            </button>
          </div>
        </>
      ) : null}

      {status === "done" ? (
        <section className="panel">
          <p>
            Review finished.{" "}
            {Object.values(drafts).some((d) => d.decision === "accept") ? (
              <Link href="/promote">Promote the accepted places →</Link>
            ) : (
              "Nothing accepted in this run."
            )}
          </p>
        </section>
      ) : null}
    </>
  );
}
