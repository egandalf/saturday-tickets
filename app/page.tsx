import { cookies } from "next/headers";
import { dealSaturday } from "@/lib/deal";
import { DEFAULT_RADIUS_MILES, formatOrigin, HOME, isHome, parseOrigin, parseRadius } from "@/lib/geo";
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
  let threadId = "";
  const jar = await cookies();
  const origin = parseOrigin(decodeURIComponent(jar.get("saturday-origin")?.value ?? "")) ?? HOME;
  const radiusCookie = jar.get("saturday-radius")?.value;
  const radiusMiles = radiusCookie ? parseRadius(radiusCookie) : DEFAULT_RADIUS_MILES;
  try {
    const dealt = await dealSaturday(undefined, undefined, { origin, radiusMiles });
    tickets = dealt.tickets;
    retrieve = dealt.retrieve;
    calls = dealt.calls;
    threadId = dealt.threadId;
    log.line("page.render", {
      count: tickets.length,
      ids: tickets.map((t) => t.id),
      source: retrieve.source,
      via: retrieve.via,
      operator: retrieve.operator,
      atlas: retrieve.atlas,
      threadId,
    });
  } catch (err) {
    log.error("page.deal.fail", err);
    tickets = [];
  }

  return (
    <main className="deck">
      <Tickets
        initial={tickets}
        retrieve={retrieve}
        calls={calls}
        threadId={threadId}
        initialWhere={{ label: origin.label, param: formatOrigin(origin), home: isHome(origin) }}
        initialRadius={radiusMiles}
      />
    </main>
  );
}
