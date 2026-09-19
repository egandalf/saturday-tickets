/**
 * Local only. Drive the agent framework from a terminal; the scout UI does the same with forms.
 *
 *   npm run agent -- run discover '{"focus":"history","count":4}'
 *   npm run agent -- list
 *   npm run agent -- show <id>          the audit log
 *   npm run agent -- stop <id>          what a paused execution is waiting on
 *   npm run agent -- decide <id> '<decision json>'
 *   npm run agent -- continue <id>      pick up a run that died mid-step
 */
import { summarize, eventsOf } from "./events";
import { continueExecution, openFramework, pendingStop, resumeExecution, startExecution, until } from "./runner";
import type { Decision, Execution } from "./types";

function line(e: Execution): string {
  const waiting = e.waiting ? ` · ${e.waiting.kind}: ${e.waiting.summary}` : "";
  return `${e._id}  ${e.agent}@${e.version}  ${e.status}${waiting}${e.outcome ? ` · ${e.outcome}` : ""}${e.error ? ` · ${e.error}` : ""}`;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const fw = await openFramework({ echo: command === "run" || command === "decide" || command === "continue" });
  const executions = fw.db.collection<Execution>("executions");
  try {
    if (command === "run") {
      const [agent, json] = rest;
      const id = await startExecution(fw, agent, json ? JSON.parse(json) : {});
      console.log(`started ${agent} ${id}`);
      console.log(line(await until(fw, id)));
    } else if (command === "decide") {
      const [id, json] = rest;
      await resumeExecution(fw, id, JSON.parse(json) as Decision);
      console.log(line(await until(fw, id)));
      // Wait for any children this decision started.
      for (const child of await executions.find({ parentId: id }).toArray()) console.log(`  child ${line(await until(fw, child._id))}`);
    } else if (command === "continue") {
      await continueExecution(fw, rest[0]);
      console.log(line(await until(fw, rest[0])));
    } else if (command === "list") {
      for (const e of await executions.find().sort({ createdAt: -1 }).limit(30).toArray()) console.log(line(e));
    } else if (command === "show") {
      for (const ev of await eventsOf(fw.db, rest[0])) console.log(`${String(ev.step).padStart(3)}.${ev.index}  ${ev.type.padEnd(12)} ${summarize(ev.type, ev.data)}`);
    } else if (command === "stop") {
      console.log(JSON.stringify(await pendingStop(fw, rest[0]), null, 2));
    } else {
      console.log("usage: agent run <agent> '<json>' | list | show <id> | stop <id> | decide <id> '<json>' | continue <id>");
    }
  } finally {
    await fw.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
