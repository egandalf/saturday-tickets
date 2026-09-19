"use client";

import { useState } from "react";
import { promoteAction, returnToReviewAction } from "../app/actions";
import { mapEmbed, type Answers, type PromoteItem } from "../lib/types";

type Surface = "PAVED" | "PACKED GRAVEL";
type Done = { photoUrl: string; tagsAdded: Record<string, string[]>; diff: string };

function Why({ why }: { why: string }) {
  return <span className="muted small"> ({why})</span>;
}

function YesNo({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <span className="row">
      <button type="button" aria-pressed={value === true} onClick={() => onChange(true)}>
        yes
      </button>
      <button type="button" aria-pressed={value === false} onClick={() => onChange(false)}>
        no
      </button>
    </span>
  );
}

export function PromoteCard({ item }: { item: PromoteItem }) {
  const { candidate: c, draft: d } = item;
  const [surface, setSurface] = useState<Surface | undefined>();
  const [turnaround, setTurnaround] = useState<boolean | undefined>();
  const [clay, setClay] = useState<boolean | undefined>();
  const [photoSource, setPhotoSource] = useState(d.photo?.source ?? "");
  const [credit, setCredit] = useState(d.photo?.credit ?? "");
  const [alt, setAlt] = useState(d.photo?.alt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [gone, setGone] = useState(false);

  const crossing = d.waterCrossing.value === null;
  const s = surface ?? d.surface.value;
  const t = turnaround ?? d.turnaround.value;
  const w = clay ?? d.clayWhenWet.value;
  const missing = [
    crossing ? "water crossing assessment" : null,
    s === null ? "surface" : null,
    t === null ? "turnaround" : t === false ? "turnaround (no: not a fit)" : null,
    w === null ? "clay when wet" : w === true ? "clay (yes: not a fit)" : null,
    !photoSource.trim() || !credit.trim() || !alt.trim() ? "photo, credit, alt" : null,
  ].filter(Boolean);

  async function go() {
    setBusy(true);
    setError(null);
    const answers: Answers = {
      ...(surface ? { surface } : {}),
      ...(turnaround !== undefined ? { turnaround } : {}),
      ...(clay !== undefined ? { clayWhenWet: clay } : {}),
      photo: { source: photoSource.trim(), credit: credit.trim(), alt: alt.trim() },
    };
    const result = await promoteAction(c.id, answers);
    setBusy(false);
    if (result.ok) setDone(result);
    else setError(result.error);
  }

  async function sendBack() {
    const reason = window.prompt(`Reject ${c.title}? Reason:`, "not a fit after all");
    if (reason === null) return;
    const result = await returnToReviewAction(c.id, reason);
    if (result.ok) setGone(true);
    else setError(result.error);
  }

  if (gone) return <p className="panel muted">{c.title} rejected.</p>;

  if (done) {
    return (
      <article className="panel stack decided">
        <p className="kicker">Promoted</p>
        <h2>{c.title}</h2>
        <div className="row">
          <img className="thumb" src={done.photoUrl} alt={alt} />
          <span className="small mono">{done.photoUrl}</span>
        </div>
        <p className="small">
          Tags added:{" "}
          {Object.entries(done.tagsAdded)
            .map(([k, ids]) => `${k} (${ids.join(", ")})`)
            .join(" · ") || "none"}
          . Review and commit <span className="mono">lib/places.ts</span>:
        </p>
        <pre className="diff mono">
          {done.diff.split("\n").map((line, i) => (
            <div key={i} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : ""}>
              {line || " "}
            </div>
          ))}
        </pre>
      </article>
    );
  }

  return (
    <article className="panel stack">
      <div className="row">
        <div className="grow">
          <p className="kicker">
            {c.id} · tags {c.tags?.join(", ") ?? "none"} · scouted from {c.scoutedFrom?.origin.label ?? "home"}
          </p>
          <h2>{c.title}</h2>
        </div>
        <button type="button" className="danger" onClick={sendBack}>
          Reject
        </button>
      </div>

      <div className="card">
        <dl className="facts">
          <dt>Drive</dt>
          <dd>
            {Math.round(d.route.miles)} mi, {d.route.minutes} min from home
          </dd>
          <dt>Surface</dt>
          <dd>
            {d.surface.value ?? (
              <span className="row">
                <button type="button" aria-pressed={surface === "PAVED"} onClick={() => setSurface("PAVED")}>
                  paved
                </button>
                <button type="button" aria-pressed={surface === "PACKED GRAVEL"} onClick={() => setSurface("PACKED GRAVEL")}>
                  packed gravel
                </button>
              </span>
            )}
            <Why why={d.surface.why} />
          </dd>
          <dt>Turnaround</dt>
          <dd>
            {d.turnaround.value === null ? <YesNo value={turnaround} onChange={setTurnaround} /> : String(d.turnaround.value)}
            <Why why={d.turnaround.why} />
          </dd>
          <dt>Clay when wet</dt>
          <dd>
            {d.clayWhenWet.value === null ? <YesNo value={clay} onChange={setClay} /> : String(d.clayWhenWet.value)}
            <Why why={d.clayWhenWet.why} />
          </dd>
          <dt>Water crossing</dt>
          <dd className={crossing ? "flag" : ""}>
            {crossing ? "needs a full assessment before promote" : "none"}
            <Why why={d.waterCrossing.why} />
          </dd>
          <dt>On site</dt>
          <dd>{c.onSiteMinutes} min</dd>
          {c.reviewNote ? (
            <>
              <dt>Note</dt>
              <dd>{c.reviewNote}</dd>
            </>
          ) : null}
        </dl>
        <iframe className="map" src={mapEmbed(c.location.lat, c.location.lng)} title={`${c.title} map`} loading="lazy" />
      </div>
      {item.flags.map((f) => (
        <p key={f} className="flag small">
          {f}
        </p>
      ))}

      <div className="card">
        <div className="stack">
          <label>
            Photo (URL or local path to a landscape .jpg)
            <input value={photoSource} onChange={(e) => setPhotoSource(e.target.value)} />
          </label>
          <label>
            Credit
            <input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Your name, or Author (CC BY 4.0)" />
          </label>
          <label>
            Alt text: what the photo shows
            <input value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
        </div>
        {/^https?:\/\//.test(photoSource) ? <img className="hero" src={photoSource} alt={alt} /> : <div />}
      </div>

      <div className="row">
        <span className="grow small muted">{missing.length ? `Still needed: ${missing.join(", ")}` : "Ready."}</span>
        {error ? <span className="error small">{error}</span> : null}
        <button className="primary" type="button" disabled={Boolean(missing.length) || busy} onClick={go}>
          {busy ? "Promoting…" : "Promote to places"}
        </button>
      </div>
    </article>
  );
}
