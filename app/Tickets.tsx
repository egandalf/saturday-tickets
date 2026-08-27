"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: string;
  title: string;
  surface: "PAVED" | "PACKED GRAVEL";
  daylight: "BACK BEFORE DUSK";
};

export function Tickets({ initial }: { initial: Ticket[] }) {
  const [tickets, setTickets] = useState(initial);

  useEffect(() => {
    if (initial.length) return;
    fetch("/api/deal")
      .then((res) => res.json())
      .then((data: { tickets?: Ticket[] }) => {
        if (data.tickets?.length) setTickets(data.tickets);
      })
      .catch(() => undefined);
  }, [initial]);

  return (
    <section className="tickets" aria-label="Saturday tickets">
      {tickets.map((ticket) => (
        <article className="ticket" key={ticket.id}>
          <div className="photo" role="img" aria-label="Photo placeholder" />
          <div className="ticket-body">
            <h2>{ticket.title}</h2>
            <div className="chips">
              <span className="chip">{ticket.surface}</span>
              <span className="chip">{ticket.daylight}</span>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
