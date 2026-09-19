"use client";

import { useState } from "react";
import { mapLink, type Decision, type Leads } from "../../lib/types";

export function SelectPanel({ leads, busy, onDecide }: { leads: Leads; busy: boolean; onDecide: (d: Decision) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = () =>
    onDecide({
      kind: "select",
      selected: [...picked],
      rejected: leads.leads.filter((l) => !picked.has(l.id)).map((l) => ({ id: l.id, reason: reasons[l.id]?.trim() || "not selected" })),
    });

  return (
    <div className="stack">
      <h2>Which leads should be researched?</h2>
      <p className="muted small">Each one you pick becomes its own research execution with its own approval. The rest are remembered as passed over, so later runs skip them.</p>
      {leads.leads.map((l) => (
        <div key={l.id} className={`panel stack ${picked.has(l.id) ? "decided" : ""}`}>
          <div className="row">
            <button type="button" aria-pressed={picked.has(l.id)} onClick={() => toggle(l.id)}>
              {picked.has(l.id) ? "Researching" : "Research"}
            </button>
            <h3 className="grow">{l.title}</h3>
            <span className="small muted">
              {l.kinds.join(", ")} · {l.where}
            </span>
          </div>
          <p>{l.why}</p>
          <p className="small">
            {l.approxLocation ? (
              <a href={mapLink(l.approxLocation.lat, l.approxLocation.lng)} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
                map
              </a>
            ) : null}
            {l.sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
                {new URL(s).hostname}
              </a>
            ))}
          </p>
          {!picked.has(l.id) ? (
            <input
              placeholder="Why pass on it? (optional, remembered)"
              value={reasons[l.id] ?? ""}
              onChange={(e) => setReasons((r) => ({ ...r, [l.id]: e.target.value }))}
            />
          ) : null}
        </div>
      ))}
      {leads.dropped.length ? (
        <p className="small muted">Dropped by the tool: {leads.dropped.map((d) => `${d.id} (${d.why})`).join("; ")}</p>
      ) : null}
      <div className="row">
        <button className="primary" type="button" disabled={busy} onClick={submit}>
          {picked.size ? `Research ${picked.size}, pass on ${leads.leads.length - picked.size}` : "Pass on all"}
        </button>
      </div>
    </div>
  );
}
