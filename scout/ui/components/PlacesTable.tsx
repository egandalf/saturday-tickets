"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { applyTravelAction, locateAction } from "../app/actions";
import { clock, mapEmbed, mapLink, type TravelRow } from "../lib/types";

const FAR_FROM_ROAD_MILES = 0.25;

function delta(r: TravelRow): number | null {
  return r.routed ? r.routed.minutes - r.stored.minutes : null;
}

export function PlacesTable({ rows }: { rows: TravelRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [started, setStarted] = useState<string[]>([]);

  const pending = rows.filter((r) => r.routed && !r.applied);
  const unlocated = rows.filter((r) => !r.routed);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    setBusy(true);
    setMessage(null);
    const result = await applyTravelAction([...selected]);
    setBusy(false);
    setMessage(result.ok ? `Updated ${result.updated} place(s).` : result.error);
    if (result.ok) setSelected(new Set());
    router.refresh();
  }

  async function locate(targets: TravelRow[]) {
    setMessage(null);
    setLocating(true);
    const result = await locateAction(targets.map((r) => ({ placeId: r.id, title: r.title, photoAlt: r.photoAlt, note: r.note })));
    setLocating(false);
    if (result.ok) setStarted((s) => [...s, ...result.ids]);
    else setMessage(result.error);
  }

  return (
    <>
      <div className="panel row">
        <span className="grow small">
          {pending.length} routed, not yet applied · {unlocated.length} without a pin
        </span>
        <button type="button" onClick={() => setSelected(new Set(pending.map((r) => r.id)))} disabled={!pending.length}>
          Select all routed
        </button>
        <button className="primary" type="button" onClick={apply} disabled={!selected.size || busy}>
          {busy ? "Applying…" : `Apply ${selected.size || ""} routed`}
        </button>
        <button type="button" onClick={() => locate(unlocated)} disabled={locating || !unlocated.length}>
          {`Locate ${unlocated.length} unpinned`}
        </button>
        {message ? <span className="small">{message}</span> : null}
      </div>

      {started.length ? (
        <p className="panel small">
          Started {started.length} locate execution(s):{" "}
          {started.map((id, i) => (
            <span key={id}>
              {i ? ", " : ""}
              <Link href={`/executions/${id}`}>{id.slice(0, 8)}</Link>
            </span>
          ))}
          . Their pins wait for your approval in the <Link href="/">Inbox</Link>.
        </p>
      ) : null}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>Place</th>
              <th>Stored</th>
              <th>Routed</th>
              <th>Δ</th>
              <th>Home by</th>
              <th>Pin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = delta(r);
              const far = r.routed && r.routed.snapMiles > FAR_FROM_ROAD_MILES;
              const guess = r.routed && /best guess|inferred|not (independently )?confirmed|midpoint/i.test(r.routed.what);
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      {r.routed && !r.applied ? (
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`select ${r.title}`} />
                      ) : null}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <img className="thumb" src={r.photo} alt="" />
                        <div>
                          <button type="button" style={{ border: 0, padding: 0 }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {r.title}
                          </button>
                          <div className="small muted">
                            {r.tags.join(", ") || "untagged"} · {r.surface.toLowerCase()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {r.stored.miles} mi · {r.stored.minutes} min
                    </td>
                    <td>
                      {r.routed ? (
                        <>
                          {r.routed.miles} mi · {r.routed.minutes} min
                          {r.applied ? <span className="chip good" style={{ marginLeft: 8 }}>applied</span> : null}
                        </>
                      ) : (
                        <button type="button" onClick={() => locate([r])} disabled={locating}>
                          Locate
                        </button>
                      )}
                    </td>
                    <td className={d !== null && Math.abs(d) >= 15 ? "flag" : ""}>
                      {d === null ? "—" : `${d > 0 ? "+" : ""}${d}m`}
                    </td>
                    <td>
                      {clock(r.stored.homeBy)}
                      {r.routed ? ` → ${clock(r.routed.homeBy)}` : ""}
                      {r.routed && !r.routed.duskOk ? <span className="flag small"> after dusk all year</span> : null}
                    </td>
                    <td className="small">
                      {far ? <div className="flag">{r.routed!.snapMiles} mi from a road</div> : null}
                      {guess ? <div className="flag">best guess</div> : null}
                      {r.routed ? (
                        <button type="button" style={{ padding: "2px 10px" }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {open === r.id ? "hide" : "map"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {open === r.id && r.routed ? (
                    <tr>
                      <td />
                      <td colSpan={6}>
                        <div className="card">
                          <iframe className="map" src={mapEmbed(r.routed.lat, r.routed.lng, 0.006)} title={`${r.title} pin`} loading="lazy" />
                          <div className="stack small">
                            <p>{r.routed.what}</p>
                            <p className="muted">
                              Source: <span className="mono">{r.routed.source}</span>
                            </p>
                            <p>
                              <a href={mapLink(r.routed.lat, r.routed.lng)} target="_blank" rel="noreferrer">
                                Open in OpenStreetMap
                              </a>{" "}
                              · {r.routed.lat}, {r.routed.lng}
                            </p>
                            <button type="button" onClick={() => locate([r])} disabled={locating}>
                              Locate again
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
