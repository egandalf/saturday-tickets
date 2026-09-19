"use client";

import { useState } from "react";
import { KIND_LIST, mapEmbed, mapLink, type CardData, type Decision } from "../lib/types";

type Kind = (typeof KIND_LIST)[number];

export function CandidateCard({
  card,
  draft,
  onDecide,
}: {
  card: CardData;
  draft: Decision | undefined;
  onDecide: (decision: Decision | null) => void;
}) {
  const c = card.request.candidate;
  const photos = "error" in c.enrichment.photos ? [] : c.enrichment.photos;
  const route = "error" in c.enrichment.route ? null : c.enrichment.route;

  const [tags, setTags] = useState<Kind[]>(draft?.decision === "accept" ? draft.tags : c.kinds);
  const [photo, setPhoto] = useState<number | null>(
    draft?.decision === "accept" ? draft.photo : photos.length ? 0 : null,
  );
  const [note, setNote] = useState(draft?.decision === "accept" ? (draft.note ?? "") : "");
  const [reason, setReason] = useState(draft?.decision === "reject" ? draft.reason : "");

  const toggle = (k: Kind) => setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
  const accept = () => onDecide({ id: c.id, decision: "accept", tags, note: note.trim() || null, photo });
  const reject = () => onDecide({ id: c.id, decision: "reject", reason: reason.trim() || "not a fit" });

  return (
    <article className={`panel stack ${draft ? "decided" : ""}`}>
      <div className="row">
        <div className="grow">
          <p className="kicker">
            {card.request.index + 1} of {card.request.total} · {c.id}
          </p>
          <h2>{c.title}</h2>
        </div>
        {draft ? (
          <span className={`chip ${draft.decision === "accept" ? "good" : draft.decision === "reject" ? "bad" : ""}`}>
            {draft.decision === "accept" ? `accept · ${draft.tags.join(", ")}` : draft.decision}
          </span>
        ) : null}
      </div>
      <p>{c.summary}</p>

      <div className="card">
        <div className="stack">
          <dl className="facts">
            <dt>Drive</dt>
            <dd>{route ? `${route.miles} mi, ${route.minutes} min from home` : "route unavailable"}</dd>
            <dt>Approach</dt>
            <dd>
              {route
                ? `last 5 mi: ${route.approach.paved} paved, ${route.approach.gravel} gravel, ${route.approach.rough} rough, ${route.approach.unknown} unknown → ${route.suggestedSurface}`
                : "—"}
            </dd>
            <dt>Sources say</dt>
            <dd>
              surface {c.surface} · turnaround {c.turnaround} · clay when wet {c.clayWhenWet} · water crossing {c.waterCrossing}
            </dd>
            {c.waterCrossingNotes ? (
              <>
                <dt>Crossing</dt>
                <dd>{c.waterCrossingNotes}</dd>
              </>
            ) : null}
            <dt>On site</dt>
            <dd>{c.onSiteMinutes} min</dd>
            {c.seasonNote ? (
              <>
                <dt>Season</dt>
                <dd>{c.seasonNote}</dd>
              </>
            ) : null}
            {c.address ? (
              <>
                <dt>Address</dt>
                <dd>{c.address}</dd>
              </>
            ) : null}
          </dl>
          <p className="small muted">{card.summary}</p>
          {card.flags.map((f) => (
            <p key={f} className="flag small">
              {f}
            </p>
          ))}
          {c.concerns.map((x) => (
            <p key={x} className="small">
              ⚠ {x}
            </p>
          ))}
          <p className="small">
            {c.sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
                {new URL(s).hostname}
              </a>
            ))}
          </p>
        </div>
        <div className="stack">
          <iframe className="map" src={mapEmbed(c.location.lat, c.location.lng)} title={`${c.title} map`} loading="lazy" />
          <p className="small muted">
            Pin from <span className="mono">{c.locationSource}</span> ·{" "}
            <a href={mapLink(c.location.lat, c.location.lng)} target="_blank" rel="noreferrer">
              open map
            </a>
          </p>
        </div>
      </div>

      {photos.length ? (
        <div className="stack">
          <p className="kicker">Photo for the ticket</p>
          <div className="photos">
            {photos.map((p, i) => (
              <button key={p.pageUrl} type="button" className="photo-pick" aria-pressed={photo === i} onClick={() => setPhoto(i)}>
                <img src={p.url} alt={p.description || p.title} loading="lazy" />
                <span>
                  {p.credit} · {p.meters} m
                </span>
              </button>
            ))}
            <button type="button" className="photo-pick" aria-pressed={photo === null} onClick={() => setPhoto(null)}>
              <span style={{ padding: 16 }}>None of these; I&apos;ll add one at promote</span>
            </button>
          </div>
        </div>
      ) : (
        <p className="small muted">No openly licensed photos nearby; you&apos;ll add one at promote.</p>
      )}

      <div className="row">
        <span className="muted small">Tags</span>
        {KIND_LIST.map((k) => (
          <button key={k} type="button" aria-pressed={tags.includes(k)} onClick={() => toggle(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="grow">
          Note on the place (scope, e.g. &ldquo;dam/beach only&rdquo;)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="grow">
          Reason, if rejecting
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button className="primary" type="button" disabled={!tags.length} onClick={accept}>
          Accept
        </button>
        <button className="danger" type="button" onClick={reject}>
          Reject
        </button>
        <button type="button" onClick={() => onDecide({ id: c.id, decision: "skip" })}>
          Skip
        </button>
        {draft ? (
          <button type="button" onClick={() => onDecide(null)}>
            Undo
          </button>
        ) : null}
      </div>
    </article>
  );
}
