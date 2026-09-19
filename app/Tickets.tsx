"use client";

import { FormEvent, useEffect, useState } from "react";
import { SYS_COLOR, type DealCall } from "@/lib/trace";

const MOODS = ["Lake", "Woods", "Town", "History"] as const;
type MoodLabel = (typeof MOODS)[number];

/** Where the deal starts; param is "lat,lng,Label" for the API and the cookie. */
type Where = { label: string; param: string; home: boolean };

const RADIUS_CHOICES = [60, 90, 150, 200] as const;
const DEFAULT_RADIUS = 150;
const YEAR = 60 * 60 * 24 * 365;

function remember(name: string, value: string | null): void {
  document.cookie = value === null
    ? `${name}=; path=/; max-age=0; samesite=lax`
    : `${name}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; samesite=lax`;
}

type Ticket = {
  id: string;
  title: string;
  surface: "PAVED" | "PACKED GRAVEL";
  daylight: "BACK BEFORE DUSK";
  drive: string;
  onSite: string;
  leaveBy: string;
  photo: string;
  photoAlt: string;
  credit?: string;
  waterCrossing?: "WATER CROSSING";
};

type Retrieve = {
  source: "atlas" | "seed";
  via: "vector" | "find" | null;
  operator: "$vectorSearch" | "find" | "seed";
  atlas: { n: number; withCredit: number } | null;
  mood: string | null;
};

type DealPayload = {
  tickets?: Ticket[];
  retrieve?: Retrieve;
  calls?: DealCall[];
  threadId?: string;
  origin?: Where;
  radiusMiles?: number;
};

function familyLede(count: number, where: Where, radius: number): string {
  const from = where.home ? "from the driveway" : `from ${where.label.split(",")[0].replace(/^Near /, "near ")}`;
  if (count === 0) return `No family Saturdays within ${radius} miles ${from} yet.`;
  if (count === 1) return `One family Saturday ${from}.`;
  if (count === 2) return `Two family Saturdays ${from}.`;
  return `Three family Saturdays ${from}.`;
}

function kv(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  return Object.entries(fields)
    .map(([k, v]) => {
      if (v === undefined) return null;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return `${k}=${v}`;
      }
      return `${k}=${JSON.stringify(v)}`;
    })
    .filter(Boolean)
    .join("  ");
}

function printTrace(label: string, calls: DealCall[], tickets: Ticket[]) {
  console.group(
    `%cSATURDAY%c  ${label}`,
    "color:#ffac00;font-weight:700;font-family:ui-monospace,monospace",
    "color:#9a9a9a;font-family:ui-monospace,monospace",
  );
  for (const call of calls) {
    const extra = kv(call.fields);
    console.log(
      `%c${call.sys.padEnd(6)}%c  ${call.scope}${extra ? `  ${extra}` : ""}`,
      `color:${SYS_COLOR[call.sys]};font-weight:700;font-family:ui-monospace,monospace`,
      "color:#c8c8c8;font-family:ui-monospace,monospace",
    );
  }
  for (const ticket of tickets) {
    console.log(
      `%cBLOB  %c  ${ticket.id}  ${ticket.photo}`,
      `color:${SYS_COLOR.BLOB};font-weight:700;font-family:ui-monospace,monospace`,
      "color:#c8c8c8;font-family:ui-monospace,monospace",
    );
  }
  console.groupEnd();
}

export function Tickets({
  initial,
  retrieve,
  calls: initialCalls,
  threadId: initialThreadId,
  initialWhere,
  initialRadius,
}: {
  initial: Ticket[];
  retrieve: Retrieve;
  calls: DealCall[];
  threadId: string;
  initialWhere: Where;
  initialRadius: number;
}) {
  const [tickets, setTickets] = useState(initial);
  const [path, setPath] = useState(retrieve);
  const [calls, setCalls] = useState(initialCalls);
  const [mood, setMood] = useState<MoodLabel | null>(null);
  const [avoidWater, setAvoidWater] = useState(false);
  const [threadId, setThreadId] = useState(initialThreadId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState(initialWhere);
  const [radius, setRadius] = useState(initialRadius);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  function applyDeal(label: string, data: DealPayload) {
    if (data.retrieve) setPath(data.retrieve);
    const nextTickets = data.tickets?.length ? data.tickets : [];
    const nextCalls = data.calls ?? [];
    if (typeof data.threadId === "string" && data.threadId) {
      setThreadId(data.threadId);
    }
    // An empty deal from a new origin or radius is the honest answer; don't leave old tickets up.
    setTickets(nextTickets);
    setCalls(nextCalls);
    if (nextTickets.length) {
      printTrace(label, nextCalls, nextTickets);
    } else {
      console.log(
        `%cCLIENT%c  fetch.empty`,
        `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
        "color:#c8c8c8;font-family:ui-monospace,monospace",
      );
    }
  }

  useEffect(() => {
    const sameWhere = where.param === initialWhere.param && radius === initialRadius;
    if (mood === null && !avoidWater && sameWhere && initial.length) {
      setTickets(initial);
      setPath(retrieve);
      setCalls(initialCalls);
      setThreadId(initialThreadId);
      printTrace("thursday notes", initialCalls, initial);
      return;
    }
    const query = new URLSearchParams();
    if (mood) query.set("mood", mood.toLowerCase());
    if (avoidWater) query.set("water", "avoid");
    if (!where.home) query.set("from", where.param);
    if (radius !== DEFAULT_RADIUS) query.set("radius", String(radius));
    const url = query.size ? `/api/deal?${query}` : "/api/deal";
    console.log(
      `%cCLIENT%c  GET ${url}`,
      `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
      "color:#c8c8c8;font-family:ui-monospace,monospace",
    );
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DealPayload) => applyDeal(mood ? mood.toLowerCase() : "thursday notes", data))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `%cCLIENT%c  fetch.fail  ${message}`,
          `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
          "color:#c8c8c8;font-family:ui-monospace,monospace",
        );
      });
  }, [mood, avoidWater, where, radius, initial, retrieve, initialCalls, initialThreadId, initialWhere, initialRadius]);

  function startFrom(next: Where) {
    setWhere(next);
    remember("saturday-origin", next.home ? null : next.param);
    setPicking(false);
    setQuery("");
    setPickError(null);
  }

  function chooseRadius(miles: number) {
    setRadius(miles);
    remember("saturday-radius", miles === DEFAULT_RADIUS ? null : String(miles));
  }

  async function lookUp(params: URLSearchParams) {
    setFinding(true);
    setPickError(null);
    try {
      const res = await fetch(`/api/origin?${params}`, { cache: "no-store" });
      const data = (await res.json()) as Where & { error?: string };
      if (!res.ok || data.error) setPickError(data.error ?? "couldn't find that place");
      else startFrom({ label: data.label, param: data.param, home: data.home });
    } catch (err: unknown) {
      setPickError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinding(false);
    }
  }

  function onFind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim()) void lookUp(new URLSearchParams({ q: query.trim() }));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setPickError("This browser can't share its location.");
      return;
    }
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => void lookUp(new URLSearchParams({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) })),
      (err) => {
        setFinding(false);
        setPickError(`Location isn't available: ${err.message}`);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  async function postDeal(body: Record<string, unknown>, label: string) {
    if (!threadId || busy) return;
    setBusy(true);
    console.log(
      `%cCLIENT%c  POST /api/deal  ${label}`,
      `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
      "color:#c8c8c8;font-family:ui-monospace,monospace",
    );
    try {
      const res = await fetch("/api/deal", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          mood: mood ? mood.toLowerCase() : undefined,
          avoidWater,
          from: where.home ? undefined : where.param,
          radius,
          ...body,
        }),
      });
      applyDeal(label, (await res.json()) as DealPayload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `%cCLIENT%c  post.fail  ${message}`,
        `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
        "color:#c8c8c8;font-family:ui-monospace,monospace",
      );
    } finally {
      setBusy(false);
    }
  }

  function onSkip(slot: number) {
    void postDeal({ slot }, `skip ${slot}`);
  }

  async function onNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = note.trim();
    if (!text || !threadId || busy) return;
    await postDeal({ note: text }, "change this deal");
    setNote("");
  }

  return (
    <>
      <header>
        <p className="kicker">Saturday tickets</p>
        <h1>{familyLede(tickets.length, where, radius)}</h1>
        <div className="origin">
          <p className="origin-line">
            From <strong>{where.label}</strong> · within {radius} mi ·{" "}
            <button type="button" className="origin-toggle" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
              {picking ? "Done" : "Change"}
            </button>
          </p>
          {picking ? (
            <div className="origin-picker">
              <form className="revise-row" onSubmit={onFind}>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Town, ZIP, or address"
                  aria-label="Start from"
                  autoComplete="off"
                />
                <button className="go" type="submit" disabled={finding || !query.trim()}>
                  {finding ? "…" : "Find"}
                </button>
              </form>
              <div className="origin-row">
                <button type="button" className="mood-chip" onClick={useMyLocation} disabled={finding}>
                  Use my location
                </button>
                {!where.home ? (
                  <button type="button" className="mood-chip" onClick={() => void lookUp(new URLSearchParams({ q: "home" }))} disabled={finding}>
                    Home
                  </button>
                ) : null}
                <label className="origin-radius">
                  Within{" "}
                  <select value={radius} onChange={(event) => chooseRadius(Number(event.target.value))}>
                    {RADIUS_CHOICES.map((miles) => (
                      <option key={miles} value={miles}>
                        {miles} mi
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {pickError ? <p className="origin-error">{pickError}</p> : null}
            </div>
          ) : null}
        </div>
      </header>
      <div className="mood">
        <p className="mood-label">Tonight we’re in the mood for</p>
        <div className="mood-chips" role="group" aria-label="Tonight we’re in the mood for">
          {MOODS.map((label) => (
            <button
              key={label}
              type="button"
              className="mood-chip"
              aria-pressed={mood === label}
              onClick={() => setMood((current) => (current === label ? null : label))}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="mood-chip"
            aria-pressed={avoidWater}
            onClick={() => setAvoidWater((current) => !current)}
          >
            No water crossings
          </button>
        </div>
      </div>
      <section
        className="tickets"
        aria-label="Saturday tickets"
        data-retrieve={path.operator}
        data-mood={path.mood ?? ""}
        data-atlas-n={path.atlas?.n ?? ""}
        data-atlas-credits={path.atlas?.withCredit ?? ""}
      >
        {tickets.map((ticket, slot) => (
          <article className="ticket" key={`${slot}-${ticket.id}`}>
            <div className="ticket-photo">
              <img className="photo" src={ticket.photo} alt={ticket.photoAlt} />
              <button
                type="button"
                className="skip"
                onClick={() => onSkip(slot)}
                disabled={busy || !threadId}
              >
                Skip
              </button>
              <div className="ticket-overlay">
                <h2>{ticket.title}</h2>
                <div className="chips">
                  <span className="chip">{ticket.surface}</span>
                  <span className="chip">{ticket.daylight}</span>
                  {ticket.waterCrossing ? <span className="chip">{ticket.waterCrossing}</span> : null}
                </div>
              </div>
            </div>
            <div className="ticket-body">
              <p className="facts">
                {ticket.drive} · {ticket.onSite} · {ticket.leaveBy}
              </p>
              {ticket.credit ? <p className="credit">{ticket.credit}</p> : null}
            </div>
          </article>
        ))}
      </section>
      <section className="revise" aria-label="Change this deal">
        <p className="kicker">Change this deal</p>
        <form className="revise-row" onSubmit={onNote}>
          <input
            type="text"
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Swap the middle"
            aria-label="Change this deal"
            autoComplete="off"
          />
          <button className="go" type="submit" disabled={busy || !threadId || !note.trim()}>
            Go
          </button>
        </form>
      </section>
    </>
  );
}
