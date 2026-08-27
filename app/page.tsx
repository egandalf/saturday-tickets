import { dealSaturday } from "@/lib/deal";
import { log } from "@/lib/log";
import { Tickets } from "./Tickets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let tickets: Awaited<ReturnType<typeof dealSaturday>> = [];
  try {
    tickets = await dealSaturday();
    log.line("page.render", { count: tickets.length, ids: tickets.map((t) => t.id) });
  } catch (err) {
    log.error("page.deal.fail", err);
    tickets = [];
  }

  return (
    <main className="deck">
      <header>
        <p className="kicker">Thursday night</p>
        <h1>Three tickets. One Saturday.</h1>
        <p className="lede">
          Three Saturday ideas from the driveway. Leave after breakfast, home before dusk.
        </p>
      </header>
      <Tickets initial={tickets} />
    </main>
  );
}
