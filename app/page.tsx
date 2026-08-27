import { dealSaturday } from "@/lib/deal";
import { Tickets } from "./Tickets";

export default async function HomePage() {
  let tickets: Awaited<ReturnType<typeof dealSaturday>> = [];
  try {
    tickets = await dealSaturday();
  } catch {
    tickets = [];
  }

  return (
    <main className="deck">
      <header>
        <p className="kicker">Thursday night</p>
        <h1>Three tickets. One Saturday.</h1>
        <p className="lede">
          Three family Saturdays from the driveway. Surface and daylight on the ticket.
          Turnaround and water crossings stay off the card.
        </p>
      </header>
      <Tickets initial={tickets} />
    </main>
  );
}
