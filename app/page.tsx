import { dealSaturday } from "@/lib/deal";
import { log } from "@/lib/log";
import { Tickets } from "./Tickets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let tickets: Awaited<ReturnType<typeof dealSaturday>>["tickets"] = [];
  let retrieve: Awaited<ReturnType<typeof dealSaturday>>["retrieve"] = {
    source: "seed",
    via: null,
    operator: "seed",
  };
  try {
    const dealt = await dealSaturday();
    tickets = dealt.tickets;
    retrieve = dealt.retrieve;
    log.line("page.render", {
      count: tickets.length,
      ids: tickets.map((t) => t.id),
      source: retrieve.source,
      via: retrieve.via,
      operator: retrieve.operator,
    });
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
      <Tickets initial={tickets} retrieve={retrieve} />
    </main>
  );
}
