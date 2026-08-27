import { dealSaturday } from "@/lib/deal";
import { log } from "@/lib/log";
import { Tickets } from "./Tickets";
import type { DealCall } from "@/lib/trace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let tickets: Awaited<ReturnType<typeof dealSaturday>>["tickets"] = [];
  let retrieve: Awaited<ReturnType<typeof dealSaturday>>["retrieve"] = {
    source: "seed",
    via: null,
    operator: "seed",
    atlas: null,
    mood: null,
  };
  let calls: DealCall[] = [];
  try {
    const dealt = await dealSaturday();
    tickets = dealt.tickets;
    retrieve = dealt.retrieve;
    calls = dealt.calls;
    log.line("page.render", {
      count: tickets.length,
      ids: tickets.map((t) => t.id),
      source: retrieve.source,
      via: retrieve.via,
      operator: retrieve.operator,
      atlas: retrieve.atlas,
    });
  } catch (err) {
    log.error("page.deal.fail", err);
    tickets = [];
  }

  return (
    <main className="deck">
      <Tickets initial={tickets} retrieve={retrieve} calls={calls} />
    </main>
  );
}
