import Link from "next/link";
import { signedTags } from "../../../lib/places";
import { MODEL } from "../../graph";
import { KINDS } from "../../lib/candidate";
import { APP_HOME, APP_RADIUS_MILES } from "../../lib/origin";
import { listRuns } from "../../lib/runs";
import { startRunAction } from "./actions";
import { getDb } from "../lib/server";

export const dynamic = "force-dynamic";

function when(date: Date): string {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function RunsPage() {
  const db = await getDb();
  const [runs, places, waiting] = await Promise.all([
    listRuns(db),
    db.collection("places").find({}, { projection: { id: 1 } }).toArray(),
    db.collection("candidates").countDocuments({ status: "accepted", promotedAt: { $exists: false } }),
  ]);
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<(typeof KINDS)[number], number>;
  for (const p of places) for (const t of signedTags(String(p.id))) counts[t]++;
  const thinnest = KINDS.reduce((a, b) => (counts[b] < counts[a] ? b : a));

  return (
    <>
      <header>
        <p className="kicker">Scout</p>
        <h1>Find new Saturday places</h1>
        <p className="muted">
          {places.length} places · {KINDS.map((k) => `${k} ${counts[k]}`).join(" · ")}
          {waiting ? (
            <>
              {" · "}
              <Link href="/promote">{waiting} accepted, waiting to promote</Link>
            </>
          ) : null}
        </p>
      </header>

      <form action={startRunAction} className="panel stack">
        <h2>New run</h2>
        <div className="row">
          <label>
            Focus
            <select name="focus" defaultValue="">
              <option value="">Thinnest kind ({thinnest})</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="custom">Something specific…</option>
            </select>
          </label>
          <label className="grow">
            Something specific (when chosen)
            <input name="customFocus" placeholder="covered bridges, swimming beaches, fire towers…" />
          </label>
          <label>
            How many
            <input name="count" type="number" min={1} max={10} defaultValue={3} style={{ width: 80 }} />
          </label>
        </div>
        <div className="row">
          <label>
            Look around
            <select name="where" defaultValue="home">
              <option value="home">Home ({APP_HOME.label})</option>
              <option value="custom">Somewhere else…</option>
            </select>
          </label>
          <label className="grow">
            Somewhere else: lat,lng,Label
            <input name="origin" placeholder="35.59,-82.55,Asheville NC" />
          </label>
          <label>
            Radius (mi)
            <input name="radius" type="number" min={5} max={500} defaultValue={APP_RADIUS_MILES} style={{ width: 90 }} />
          </label>
        </div>
        <div className="row">
          <button className="primary" type="submit">
            Start scouting
          </button>
          <span className="muted small">
            {MODEL} researches with Tavily; each candidate is routed from home and checked against open data before you see it.
          </span>
        </div>
      </form>

      <section className="panel">
        <h2>Runs</h2>
        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Focus</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.threadId}>
                    <td>
                      <Link href={`/runs/${r.threadId}`}>{when(r.startedAt)}</Link>
                    </td>
                    <td>{r.params.focus ?? "thinnest"}</td>
                    <td>
                      {r.params.run.origin.label} · {r.params.run.radiusMiles} mi
                    </td>
                    <td className={`status-${r.status}`}>{r.status === "review" ? "ready to review" : r.status}</td>
                    <td>{r.candidates ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No runs yet.</p>
        )}
      </section>
    </>
  );
}
