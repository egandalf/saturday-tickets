"use client";

import { useMemo, useState } from "react";
import { KIND_LIST, mapEmbed, type Decision, type PlaceDraft } from "../../lib/types";

type Kind = (typeof KIND_LIST)[number];
type YesNo = "yes" | "no" | "unknown";

export function PlaceApprovePanel({ out, busy, onDecide }: { out: PlaceDraft; busy: boolean; onDecide: (d: Decision) => void }) {
  const { draft, enrichment, flags, run } = out;
  const route = "error" in enrichment.route ? null : enrichment.route;
  const photoOptions = useMemo(() => {
    const seen = new Set<string>();
    const fromAgent = draft.photos.map((p) => ({ url: p.url, credit: p.credit, alt: p.alt, pageUrl: p.pageUrl }));
    const fromOpenData = "error" in enrichment.photos ? [] : enrichment.photos.map((p) => ({ url: p.url, credit: p.credit, alt: p.description || p.title, pageUrl: p.pageUrl }));
    return [...fromAgent, ...fromOpenData].filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)));
  }, [draft.photos, enrichment.photos]);

  const suggested = route && (route.suggestedSurface === "PAVED" || route.suggestedSurface === "PACKED GRAVEL") ? route.suggestedSurface : "";
  const [title, setTitle] = useState(draft.title);
  const [surface, setSurface] = useState<string>(draft.surface !== "UNKNOWN" ? draft.surface : suggested);
  const [turnaround, setTurnaround] = useState<YesNo>(draft.turnaround);
  const [clay, setClay] = useState<YesNo>(draft.clayWhenWet);
  const [onSite, setOnSite] = useState(draft.onSiteMinutes);
  const [tags, setTags] = useState<Kind[]>(draft.kinds);
  const [note, setNote] = useState("");
  const [photoIndex, setPhotoIndex] = useState<number | null>(photoOptions.length ? 0 : null);
  const [custom, setCustom] = useState({ source: "", credit: "", alt: "" });
  const chosen = photoIndex === null ? null : photoOptions[photoIndex];
  const [alt, setAlt] = useState(chosen?.alt ?? "");
  const [credit, setCredit] = useState(chosen?.credit ?? "");
  const [assessment, setAssessment] = useState(draft.waterCrossingAssessment ? JSON.stringify(draft.waterCrossingAssessment, null, 2) : "");
  const [reason, setReason] = useState("");

  const pickPhoto = (i: number | null) => {
    setPhotoIndex(i);
    setAlt(i === null ? custom.alt : photoOptions[i].alt);
    setCredit(i === null ? custom.credit : photoOptions[i].credit);
  };
  const photo = photoIndex === null ? { source: custom.source, credit, alt } : { source: photoOptions[photoIndex].url, credit, alt };

  const missing = [
    !route ? "a routed drive (route failed)" : null,
    surface !== "PAVED" && surface !== "PACKED GRAVEL" ? "surface" : null,
    turnaround !== "yes" ? "turnaround must be yes" : null,
    clay !== "no" ? "clay when wet must be no" : null,
    !tags.length ? "tags" : null,
    !photo.source.trim() || !photo.credit.trim() || photo.alt.trim().length < 8 ? "photo, credit, alt (8+ chars)" : null,
  ].filter(Boolean);

  function approve() {
    let waterCrossingAssessment = draft.waterCrossingAssessment;
    if (draft.waterCrossing === "established") {
      try {
        waterCrossingAssessment = JSON.parse(assessment);
      } catch {
        alert("The crossing assessment isn't valid JSON.");
        return;
      }
    }
    onDecide({
      kind: "approve",
      approve: true,
      payload: {
        draft: { ...draft, title: title.trim(), surface, turnaround, clayWhenWet: clay, onSiteMinutes: onSite, kinds: tags, waterCrossingAssessment },
        travel: { miles: route!.miles, minutes: route!.minutes },
        photo: { source: photo.source.trim(), credit: photo.credit.trim(), alt: photo.alt.trim() },
        tags,
        note: note.trim() || null,
        run,
      },
    });
  }

  const select = (value: YesNo, set: (v: YesNo) => void) => (
    <select value={value} onChange={(e) => set(e.target.value as YesNo)}>
      <option value="yes">yes</option>
      <option value="no">no</option>
      <option value="unknown">unknown</option>
    </select>
  );

  return (
    <div className="stack">
      <h2>Approve {draft.title}?</h2>
      <p>{draft.summary}</p>
      {flags.map((f) => (
        <p key={f} className="flag small">
          {f}
        </p>
      ))}
      <div className="card">
        <div className="stack">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <dl className="facts">
            <dt>Drive</dt>
            <dd>{route ? `${route.miles} mi, ${route.minutes} min from home` : "route unavailable"}</dd>
            <dt>Approach</dt>
            <dd>
              {route
                ? `last 5 mi: ${route.approach.paved} paved, ${route.approach.gravel} gravel, ${route.approach.rough} rough, ${route.approach.unknown} unknown → ${route.suggestedSurface}`
                : "—"}
            </dd>
            <dt>Parks at</dt>
            <dd>
              {draft.locationWhat} <span className="muted small">({draft.locationSource})</span>
            </dd>
            {draft.seasonNote ? (
              <>
                <dt>Season</dt>
                <dd>{draft.seasonNote}</dd>
              </>
            ) : null}
          </dl>
          <div className="row">
            <label>
              Surface
              <select value={surface} onChange={(e) => setSurface(e.target.value)}>
                <option value="">choose…</option>
                <option value="PAVED">paved</option>
                <option value="PACKED GRAVEL">packed gravel</option>
              </select>
            </label>
            <label>Turnaround {select(turnaround, setTurnaround)}</label>
            <label>Clay when wet {select(clay, setClay)}</label>
            <label>
              On site (min)
              <input type="number" value={onSite} min={30} max={480} onChange={(e) => setOnSite(Number(e.target.value))} style={{ width: 90 }} />
            </label>
          </div>
          <p className="small muted">
            The agent said: surface {draft.surface}, turnaround {draft.turnaround}, clay {draft.clayWhenWet}, water crossing {draft.waterCrossing}.
          </p>
        </div>
        <iframe className="map" src={mapEmbed(draft.location.lat, draft.location.lng)} title={`${draft.title} map`} loading="lazy" />
      </div>

      {draft.waterCrossing === "established" ? (
        <label>
          Water crossing assessment (JSON; stored with the place)
          <textarea className="mono small" rows={10} value={assessment} onChange={(e) => setAssessment(e.target.value)} />
        </label>
      ) : null}

      <details open={draft.evidence.length <= 8}>
        <summary className="kicker">Evidence ({draft.evidence.length})</summary>
        <div className="table-wrap">
          <table>
            <tbody>
              {draft.evidence.map((ev, i) => (
                <tr key={i}>
                  <td>{ev.field}</td>
                  <td className={ev.confidence === "confirmed" ? "status-done" : "flag"}>{ev.confidence}</td>
                  <td>{ev.note}</td>
                  <td className="small mono">{/^https?:/.test(ev.source) ? <a href={ev.source} target="_blank" rel="noreferrer">{new URL(ev.source).hostname}</a> : ev.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {draft.concerns.map((c) => (
        <p key={c} className="small">
          ⚠ {c}
        </p>
      ))}

      <div className="stack">
        <p className="kicker">Photo for the ticket</p>
        <div className="photos">
          {photoOptions.map((p, i) => (
            <button key={p.url} type="button" className="photo-pick" aria-pressed={photoIndex === i} onClick={() => pickPhoto(i)}>
              <img src={p.url} alt={p.alt} loading="lazy" />
              <span>{p.credit}</span>
            </button>
          ))}
          <button type="button" className="photo-pick" aria-pressed={photoIndex === null} onClick={() => pickPhoto(null)}>
            <span style={{ padding: 16 }}>Use my own photo</span>
          </button>
        </div>
        {photoIndex === null ? (
          <label>
            Photo URL or local path to a landscape .jpg
            <input value={custom.source} onChange={(e) => setCustom({ ...custom, source: e.target.value })} />
          </label>
        ) : null}
        <div className="row">
          <label className="grow">
            Credit
            <input value={credit} onChange={(e) => setCredit(e.target.value)} />
          </label>
          <label className="grow">
            Alt text: what the photo shows
            <input value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="row">
        <span className="muted small">Tags</span>
        {KIND_LIST.map((k) => (
          <button key={k} type="button" aria-pressed={tags.includes(k)} onClick={() => setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]))}>
            {k}
          </button>
        ))}
        <label className="grow">
          Note on the place (scope, e.g. “dam/beach only”)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="row">
        <span className="grow small muted">{missing.length ? `Still needed: ${missing.join(", ")}` : `Approving copies the photo to Blob, adds ${title} to places, and adds its tags to lib/places.ts.`}</span>
        <button className="primary" type="button" disabled={busy || Boolean(missing.length)} onClick={approve}>
          Approve and promote
        </button>
      </div>
      <div className="row">
        <input className="grow" placeholder="Why reject? (remembered, so later runs skip it)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="danger" type="button" disabled={busy} onClick={() => onDecide({ kind: "approve", approve: false, reason: reason.trim() || "not a fit" })}>
          Reject
        </button>
      </div>
    </div>
  );
}
