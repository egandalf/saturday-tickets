"use client";

import { useEffect, useState } from "react";
import { SYS_COLOR, type DealCall } from "@/lib/trace";

const MOODS = ["Lake", "Woods", "Town", "History"] as const;
type MoodLabel = (typeof MOODS)[number];

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
};

type Retrieve = {
  source: "atlas" | "seed";
  via: "vector" | "find" | null;
  operator: "$vectorSearch" | "find" | "seed";
  atlas: { n: number; withCredit: number } | null;
  mood: string | null;
};

function familyLede(count: number): string {
  if (count === 1) return "One family Saturday from the driveway.";
  if (count === 2) return "Two family Saturdays from the driveway.";
  return "Three family Saturdays from the driveway.";
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
}: {
  initial: Ticket[];
  retrieve: Retrieve;
  calls: DealCall[];
}) {
  const [tickets, setTickets] = useState(initial);
  const [path, setPath] = useState(retrieve);
  const [calls, setCalls] = useState(initialCalls);
  const [mood, setMood] = useState<MoodLabel | null>(null);

  useEffect(() => {
    if (mood === null && initial.length) {
      setTickets(initial);
      setPath(retrieve);
      setCalls(initialCalls);
      printTrace("thursday notes", initialCalls, initial);
      return;
    }
    const url = mood ? `/api/deal?mood=${mood.toLowerCase()}` : "/api/deal";
    console.log(
      `%cCLIENT%c  GET ${url}`,
      `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
      "color:#c8c8c8;font-family:ui-monospace,monospace",
    );
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { tickets?: Ticket[]; retrieve?: Retrieve; calls?: DealCall[] }) => {
        if (data.retrieve) setPath(data.retrieve);
        const nextTickets = data.tickets?.length ? data.tickets : [];
        const nextCalls = data.calls ?? [];
        if (nextTickets.length) {
          setTickets(nextTickets);
          setCalls(nextCalls);
          printTrace(mood ? mood.toLowerCase() : "thursday notes", nextCalls, nextTickets);
        } else {
          console.log(
            `%cCLIENT%c  fetch.empty`,
            `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
            "color:#c8c8c8;font-family:ui-monospace,monospace",
          );
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `%cCLIENT%c  fetch.fail  ${message}`,
          `color:${SYS_COLOR.CLIENT};font-weight:700;font-family:ui-monospace,monospace`,
          "color:#c8c8c8;font-family:ui-monospace,monospace",
        );
      });
  }, [mood, initial, retrieve, initialCalls]);

  return (
    <>
      <header>
        <p className="kicker">Saturday tickets</p>
        <h1>{familyLede(tickets.length)}</h1>
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
        {tickets.map((ticket) => (
          <article className="ticket" key={ticket.id}>
            <img className="photo" src={ticket.photo} alt={ticket.photoAlt} />
            <div className="ticket-body">
              <h2>{ticket.title}</h2>
              <div className="chips">
                <span className="chip">{ticket.surface}</span>
                <span className="chip">{ticket.daylight}</span>
              </div>
              <p className="facts">
                {ticket.drive} · {ticket.onSite} · {ticket.leaveBy}
              </p>
              {ticket.credit ? <p className="credit">{ticket.credit}</p> : null}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
