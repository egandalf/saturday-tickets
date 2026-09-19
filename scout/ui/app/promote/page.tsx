import Link from "next/link";
import { describe } from "../../../lib/enrich";
import { blockers, draft, waiting } from "../../../lib/promote-core";
import { PromoteCard } from "../../components/PromoteCard";
import { getDb, plain } from "../../lib/server";
import type { PromoteItem } from "../../lib/types";

export const dynamic = "force-dynamic";

export default async function PromotePage() {
  const db = await getDb();
  const candidates = await waiting(db);
  const items: PromoteItem[] = await Promise.all(
    candidates.map(async (candidate) => {
      const d = await draft(candidate);
      return { candidate, draft: d, blockers: blockers(d), flags: describe(candidate.enrichment).flags };
    }),
  );

  return (
    <>
      <header>
        <p className="kicker">Promote</p>
        <h1>Accepted places, ready to deal</h1>
        <p className="muted">
          Each field comes from the sources, then open data; answer only what neither settles. Promoting copies the photo to
          Blob, embeds and upserts the place, and adds its tags to <span className="mono">lib/places.ts</span> for you to
          commit.
        </p>
      </header>
      {items.length ? (
        plain(items).map((item) => <PromoteCard key={item.candidate.id} item={item} />)
      ) : (
        <p className="panel muted">
          Nothing waiting. Accept places on a <Link href="/">run</Link> first.
        </p>
      )}
    </>
  );
}
