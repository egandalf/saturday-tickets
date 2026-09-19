/**
 * Agent definitions in Atlas. `agents` holds each agent's current version; `agent_versions` holds
 * every version, immutable, so an execution always points at exactly what it ran.
 */
import type { Db } from "mongodb";
import { SEED_AGENTS } from "./seed-agents";
import { TOOLS } from "./tools/index";
import type { AgentDefinition, AgentVersion } from "./types";

type AgentDoc = { _id: string; current: number; updatedAt: Date };

export const MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"] as const;

export function validateDefinition(def: AgentDefinition, agentNames: string[]): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(def.name)) errors.push("name: lowercase letters, digits, and dashes");
  if (!def.instructions.trim()) errors.push("instructions: required");
  if (!(MODELS as readonly string[]).includes(def.model)) errors.push(`model: one of ${MODELS.join(", ")}`);
  if (def.maxTurns < 1 || def.maxTurns > 100) errors.push("maxTurns: 1-100");
  for (const t of def.tools) {
    const found = TOOLS.get(t);
    if (!found) errors.push(`tools: no "${t}" in the library`);
    else if (found.effect === "output") errors.push(`tools: "${t}" is an output tool; set it as the output`);
  }
  const out = TOOLS.get(def.output);
  if (!out || out.effect !== "output") errors.push(`output: "${def.output}" is not an output tool`);
  if (out?.review === "select" && !def.handoff) errors.push("handoff: a select stop needs an agent to hand each chosen item to");
  if (def.handoff && !agentNames.includes(def.handoff)) errors.push(`handoff: no agent "${def.handoff}"`);
  const names = def.input.map((f) => f.name);
  if (new Set(names).size !== names.length) errors.push("input: field names must be unique");
  return errors;
}

export async function seedAgents(db: Db): Promise<void> {
  for (const def of SEED_AGENTS) {
    const exists = await db.collection<AgentDoc>("agents").findOne({ _id: def.name });
    if (exists) continue;
    await db.collection<AgentVersion>("agent_versions").insertOne({
      _id: `${def.name}@1`,
      name: def.name,
      version: 1,
      definition: def,
      note: "seeded",
      createdAt: new Date(),
    });
    await db.collection<AgentDoc>("agents").insertOne({ _id: def.name, current: 1, updatedAt: new Date() });
  }
}

export async function currentVersion(db: Db, name: string): Promise<AgentVersion> {
  const agent = await db.collection<AgentDoc>("agents").findOne({ _id: name });
  if (!agent) throw new Error(`no agent "${name}"`);
  const version = await db.collection<AgentVersion>("agent_versions").findOne({ _id: `${name}@${agent.current}` });
  if (!version) throw new Error(`agent "${name}" points at a missing version ${agent.current}`);
  return version;
}

export async function getVersion(db: Db, id: string): Promise<AgentVersion> {
  const version = await db.collection<AgentVersion>("agent_versions").findOne({ _id: id });
  if (!version) throw new Error(`no agent version ${id}`);
  return version;
}

export async function listAgents(db: Db): Promise<AgentVersion[]> {
  const agents = await db.collection<AgentDoc>("agents").find().sort({ _id: 1 }).toArray();
  return Promise.all(agents.map((a) => getVersion(db, `${a._id}@${a.current}`)));
}

export async function versionsOf(db: Db, name: string): Promise<AgentVersion[]> {
  return db.collection<AgentVersion>("agent_versions").find({ name }).sort({ version: -1 }).toArray();
}

/** Save an edit (or a new agent) as the next version and make it current. */
export async function saveVersion(db: Db, def: AgentDefinition, note: string): Promise<AgentVersion> {
  const names = (await db.collection<AgentDoc>("agents").find().toArray()).map((a) => a._id);
  const errors = validateDefinition(def, [...names, def.name]);
  if (errors.length) throw new Error(errors.join("; "));
  const latest = await db.collection<AgentVersion>("agent_versions").find({ name: def.name }).sort({ version: -1 }).limit(1).next();
  const version = (latest?.version ?? 0) + 1;
  const doc: AgentVersion = { _id: `${def.name}@${version}`, name: def.name, version, definition: def, note, createdAt: new Date() };
  await db.collection<AgentVersion>("agent_versions").insertOne(doc);
  await db.collection<AgentDoc>("agents").updateOne({ _id: def.name }, { $set: { current: version, updatedAt: new Date() } }, { upsert: true });
  return doc;
}
