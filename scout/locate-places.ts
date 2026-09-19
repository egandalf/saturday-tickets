/**
 * Local only. Pin each existing place to where the family parks, then route it from 41144.
 *
 *   npm run scout:locate -- --ids=greenbo,shawnee-packed    locate these (or every place without a location)
 *   npm run scout:locate -- --apply                          table: stored vs routed miles and minutes
 *   npm run scout:locate -- --apply --write                  write location, milesFromHome, minutesOut
 *
 * Findings accumulate in scout/data/locations.json, so a run can stop and pick up where it left off.
 * The previous travel values are kept on each place as travelPrevious.
 */
import { withDb } from "./lib/atlas";
import { locateMany } from "./lib/locate";
import { applyTravel, travelRows } from "./lib/travel";

function hhmm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

async function apply(write: boolean): Promise<void> {
  await withDb(async (db) => {
    const rows = await travelRows(db);
    console.log(`${"place".padEnd(20)} ${"stored".padStart(13)} ${"routed".padStart(13)}  Δmin  home by    snap  spot`);
    for (const r of rows) {
      const stored = `${r.stored.miles} mi ${r.stored.minutes}m`;
      if (!r.routed) {
        console.log(`${r.id.padEnd(20)} ${stored.padStart(13)} ${"—".padStart(13)}`);
        continue;
      }
      const delta = r.routed.minutes - r.stored.minutes;
      console.log(
        `${r.id.padEnd(20)} ${stored.padStart(13)} ${`${r.routed.miles} mi ${r.routed.minutes}m`.padStart(13)}  ${`${delta >= 0 ? "+" : ""}${delta}`.padStart(4)}  ${hhmm(r.stored.homeBy)}→${hhmm(r.routed.homeBy)}${r.routed.duskOk ? "" : "!"}  ${r.routed.snapMiles.toFixed(2).padStart(4)}  ${r.routed.what}`,
      );
    }
    const located = rows.filter((r) => r.routed).length;
    console.log(`\n${located} of ${rows.length} located. "!" = home after dusk even on the longest Saturday.`);
    if (!write) {
      console.log("dry run. Add --write to update places.");
      return;
    }
    console.log(`updated ${await applyTravel(db)} places`);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) return apply(argv.includes("--write"));
  const ids = argv.find((a) => a.startsWith("--ids="))?.slice(6).split(",").filter(Boolean);
  await withDb((db) => locateMany(db, ids));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
