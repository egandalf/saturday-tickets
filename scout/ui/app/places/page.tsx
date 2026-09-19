import { travelRows } from "../../../lib/travel";
import { PlacesTable } from "../../components/PlacesTable";
import { getDb, plain } from "../../lib/server";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const rows = await travelRows(await getDb());
  const located = rows.filter((r) => r.routed).length;
  return (
    <>
      <header>
        <p className="kicker">Places</p>
        <h1>Drive times from home</h1>
        <p className="muted">
          {rows.length} places · {located} pinned to where the family parks and routed from 41144. Applying writes the routed
          miles and minutes (the ticket&apos;s leave-by time) and keeps the old values as travelPrevious. Locate starts a locate execution per place; approve its pin from the Inbox.
        </p>
      </header>
      <PlacesTable rows={plain(rows)} />
    </>
  );
}
