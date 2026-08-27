"use client";

import { useEffect, useState } from "react";

const MOODS = ["Lake", "Woods", "Town", "History"] as const;
type MoodLabel = (typeof MOODS)[number];

type Ticket = {
  id: string;
  title: string;
  surface: "PAVED" | "PACKED GRAVEL";
  daylight: "BACK BEFORE DUSK";
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

function clientLog(scope: string, details: string) {
  console.log(`tickets │ ${new Date().toISOString().slice(11, 23)} │ client │ ${scope}  ${details}`);
}

export function Tickets({ initial, retrieve }: { initial: Ticket[]; retrieve: Retrieve }) {
  const [tickets, setTickets] = useState(initial);
  const [path, setPath] = useState(retrieve);
  const [mood, setMood] = useState<MoodLabel | null>(null);

  useEffect(() => {
    if (mood === null && initial.length) {
      setTickets(initial);
      setPath(retrieve);
      clientLog(
        "ssr",
        `count=${initial.length}  ids=${JSON.stringify(initial.map((t) => t.id))}  operator=${retrieve.operator}`,
      );
      return;
    }
    const url = mood ? `/api/deal?mood=${mood.toLowerCase()}` : "/api/deal";
    clientLog("fetch", `GET ${url}`);
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { tickets?: Ticket[]; retrieve?: Retrieve }) => {
        if (data.retrieve) setPath(data.retrieve);
        if (data.tickets?.length) {
          clientLog(
            "fetch.ok",
            `count=${data.tickets.length}  ids=${JSON.stringify(data.tickets.map((t) => t.id))}  mood=${data.retrieve?.mood ?? "none"}  operator=${data.retrieve?.operator ?? "?"}`,
          );
          setTickets(data.tickets);
        } else {
          clientLog("fetch.empty", "no tickets");
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`tickets │ ${new Date().toISOString().slice(11, 23)} │ client │ fetch.fail  ${message}`);
      });
  }, [mood, initial, retrieve]);

  useEffect(() => {
    for (const ticket of tickets) {
      clientLog(
        ticket.id,
        `${ticket.surface}  ${ticket.daylight}  photo=${ticket.photo}${ticket.credit ? `  credit=${ticket.credit}` : ""}`,
      );
    }
  }, [tickets]);

  return (
    <>
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
              {ticket.credit ? <p className="credit">{ticket.credit}</p> : null}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
