"use client";

import { useState } from "react";
import { mapEmbed, mapLink, type Decision, type LocatedPin } from "../../lib/types";

export function PinApprovePanel({ pin, busy, onDecide }: { pin: LocatedPin; busy: boolean; onDecide: (d: Decision) => void }) {
  const [reason, setReason] = useState("");
  const delta = pin.route.minutes - pin.stored.minutes;
  return (
    <div className="stack">
      <h2>Approve the pin for {pin.title}?</h2>
      <div className="card">
        <dl className="facts">
          <dt>Parks at</dt>
          <dd>{pin.what}</dd>
          <dt>Confidence</dt>
          <dd className={pin.confidence === "confirmed" ? "status-done" : "flag"}>{pin.confidence}</dd>
          <dt>Source</dt>
          <dd className="mono small">{pin.source}</dd>
          <dt>Stored</dt>
          <dd>
            {pin.stored.miles} mi, {pin.stored.minutes} min
          </dd>
          <dt>Routed</dt>
          <dd>
            {Math.round(pin.route.miles)} mi, {pin.route.minutes} min ({delta >= 0 ? "+" : ""}
            {delta} min)
          </dd>
          <dt>From road</dt>
          <dd className={pin.route.snapMiles > 0.25 ? "flag" : ""}>{pin.route.snapMiles} mi</dd>
          <dt>Map</dt>
          <dd>
            <a href={mapLink(pin.lat, pin.lng)} target="_blank" rel="noreferrer">
              {pin.lat}, {pin.lng}
            </a>
          </dd>
        </dl>
        <iframe className="map" src={mapEmbed(pin.lat, pin.lng, 0.006)} title={`${pin.title} pin`} loading="lazy" />
      </div>
      <div className="row">
        <span className="grow small muted">Approving writes the routed miles and minutes to the place (its leave-by time) and keeps the old values.</span>
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() =>
            onDecide({
              kind: "approve",
              approve: true,
              payload: { placeId: pin.placeId, title: pin.title, lat: pin.lat, lng: pin.lng, what: pin.what, source: pin.source, route: pin.route },
            })
          }
        >
          Approve pin
        </button>
      </div>
      <div className="row">
        <input className="grow" placeholder="Why reject? (remembered for the next locate run)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="danger" type="button" disabled={busy} onClick={() => onDecide({ kind: "approve", approve: false, reason: reason.trim() || "wrong spot" })}>
          Reject
        </button>
      </div>
    </div>
  );
}
