"use server";

import "../lib/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveVersion } from "../../framework/agents";
import { cancelExecution, continueExecution, resumeExecution, startExecution } from "../../framework/runner";
import type { AgentDefinition, Decision } from "../../framework/types";
import { applyTravel } from "../../lib/travel";
import { getDb, getFramework } from "../lib/server";
import { FIELD_PREFIX } from "../lib/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function failure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Start an agent from its generated run form; field values arrive as strings. */
export async function runAgentAction(agent: string, form: FormData): Promise<void> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(FIELD_PREFIX) || typeof value !== "string" || !value.trim()) continue;
    input[key.slice(FIELD_PREFIX.length)] = value.trim();
  }
  const id = await startExecution(await getFramework(), agent, input);
  redirect(`/executions/${id}`);
}

export async function decideAction(id: string, decision: Decision): Promise<Result> {
  try {
    await resumeExecution(await getFramework(), id, decision);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function continueAction(id: string): Promise<Result> {
  try {
    await continueExecution(await getFramework(), id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function cancelAction(id: string): Promise<Result> {
  try {
    await cancelExecution(await getDb(), id);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function saveAgentAction(definition: AgentDefinition, note: string): Promise<Result<{ version: number }>> {
  try {
    const saved = await saveVersion(await getDb(), definition, note.trim() || "edited in the UI");
    revalidatePath("/agents");
    revalidatePath(`/agents/${definition.name}`);
    return { ok: true, version: saved.version };
  } catch (err) {
    return failure(err);
  }
}

/** Places page: apply routed travel already found (scout/data/locations.json). */
export async function applyTravelAction(ids: string[]): Promise<Result<{ updated: number }>> {
  try {
    const updated = await applyTravel(await getDb(), ids);
    revalidatePath("/places");
    return { ok: true, updated };
  } catch (err) {
    return failure(err);
  }
}

/** Places page: one locate execution per place. */
export async function locateAction(places: { placeId: string; title: string; photoAlt: string; note: string }[]): Promise<Result<{ ids: string[] }>> {
  try {
    const fw = await getFramework();
    const ids: string[] = [];
    for (const p of places) ids.push(await startExecution(fw, "locate", p));
    revalidatePath("/");
    return { ok: true, ids };
  } catch (err) {
    return failure(err);
  }
}
