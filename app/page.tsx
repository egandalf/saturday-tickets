const TICKETS = [
  { title: "Saturday one", surface: "PAVED", daylight: "BACK BEFORE DUSK" },
  { title: "Saturday two", surface: "PACKED GRAVEL", daylight: "BACK BEFORE DUSK" },
  { title: "Saturday three", surface: "PAVED", daylight: "BACK BEFORE DUSK" },
] as const;

export default function HomePage() {
  return (
    <main className="deck">
      <header>
        <p className="kicker">Thursday night</p>
        <h1>Three tickets. One Saturday.</h1>
        <p className="lede">
          Layout shell only. Photos and places get seeded later. Chips are surface and
          daylight. Turnaround and water crossings stay off the card.
        </p>
      </header>
      <section className="tickets" aria-label="Saturday tickets">
        {TICKETS.map((ticket) => (
          <article className="ticket" key={ticket.title}>
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
    </main>
  );
}
