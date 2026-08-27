"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: string;
  title: string;
  surface: "PAVED" | "PACKED GRAVEL";
  daylight: "BACK BEFORE DUSK";
  photo: string;
  photoAlt: string;
  credit?: string;
};

function clientLog(scope: string, details: string) {
  console.log(`tickets │ ${new Date().toISOString().slice(11, 23)} │ client │ ${scope}  ${details}`);
}

export function Tickets({ initial }: { initial: Ticket[] }) {
  const [tickets, setTickets] = useState(initial);

  useEffect(() => {
    if (initial.length) {
      clientLog("ssr", `count=${initial.length}  ids=${JSON.stringify(initial.map((t) => t.id))}`);
      return;
    }
    clientLog("fetch", "GET /api/deal");
    fetch("/api/deal")
      .then((res) => res.json())
      .then((data: { tickets?: Ticket[] }) => {
        if (data.tickets?.length) {
          clientLog("fetch.ok", `count=${data.tickets.length}  ids=${JSON.stringify(data.tickets.map((t) => t.id))}`);
          setTickets(data.tickets);
        } else {
          clientLog("fetch.empty", "no tickets");
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`tickets │ ${new Date().toISOString().slice(11, 23)} │ client │ fetch.fail  ${message}`);
      });
  }, [initial]);

  useEffect(() => {
    for (const ticket of tickets) {
      clientLog(
        ticket.id,
        `${ticket.surface}  ${ticket.daylight}  photo=${ticket.photo}${ticket.credit ? `  credit=${ticket.credit}` : ""}`
      );
    }
  }, [tickets]);

  return (
    <section className="tickets" aria-label="Saturday tickets">
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
  );
}
