"use server";

import "../lib/env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CandidateDoc, Decision } from "../../lib/candidate";
import { locateMany } from "../../lib/locate";
import { DEFAULT_RUN, parseOrigin, parseRadius, type Run } from "../../lib/origin";
import { REPO_ROOT } from "../../lib/paths";
import { draft, promote, type Answers } from "../../lib/promote-core";
import { finishReview, saveDraft, startRun } from "../../lib/runs";
import { applyTravel } from "../../lib/travel";
import { getDb, getScout, locating } from "../lib/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function failure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export async function startRunAction(form: FormData): Promise<void> {
  const focusChoice = String(form.get("focus") ?? "");
  const custom = String(form.get("customFocus") ?? "").trim();
  const focus = focusChoice === "custom" ? custom || null : focusChoice || null;
  const count = Math.min(10, Math.max(1, Number(form.get("count") ?? 3) || 3));
  const originText = String(form.get("origin") ?? "").trim();
  const radiusText = String(form.get("radius") ?? "").trim();
  const run: Run = {
    origin: form.get("where") === "custom" && originText ? parseOrigin(originText) : DEFAULT_RUN.origin,
    radiusMiles: radiusText ? parseRadius(radiusText) : DEFAULT_RUN.radiusMiles,
  };
  const scout = await getScout();
  const { threadId, done } = await startRun(scout, { run, focus, count });
  done.catch((err) => console.error(`scout ${threadId} failed:`, err));
  redirect(`/runs/${threadId}`);
}

export async function saveDraftAction(threadId: string, candidateId: string, decision: Decision | null): Promise<Result> {
  try {
    await saveDraft(await getDb(), threadId, candidateId, decision);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function finishReviewAction(threadId: string): Promise<Result> {
  try {
    await finishReview(await getScout(), threadId);
    revalidatePath("/");
    revalidatePath("/promote");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function promoteAction(
  id: string,
  answers: Answers,
): Promise<Result<{ photoUrl: string; tagsAdded: Record<string, string[]>; diff: string }>> {
  try {
    const db = await getDb();
    const c = (await db.collection("candidates").findOne({ id, status: "accepted", promotedAt: { $exists: false } })) as unknown as
      | CandidateDoc
      | null;
    if (!c) throw new Error(`${id} is not waiting to be promoted`);
    const done = await promote(db, c, await draft(c), answers);
    const { stdout } = await promisify(execFile)("git", ["diff", "--", "lib/places.ts"], { cwd: REPO_ROOT });
    revalidatePath("/promote");
    revalidatePath("/places");
    return { ok: true, photoUrl: done.photoUrl, tagsAdded: done.tagsAdded, diff: stdout };
  } catch (err) {
    return failure(err);
  }
}

export async function returnToReviewAction(id: string, reason: string): Promise<Result> {
  try {
    const db = await getDb();
    await db
      .collection("candidates")
      .updateOne({ id, promotedAt: { $exists: false } }, { $set: { status: "rejected", rejectReason: reason || "rejected at promote" } });
    revalidatePath("/promote");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function applyTravelAction(ids: string[]): Promise<Result<{ updated: number }>> {
  try {
    const updated = await applyTravel(await getDb(), ids);
    revalidatePath("/places");
    return { ok: true, updated };
  } catch (err) {
    return failure(err);
  }
}

/** Starts the locate agent in the background; progress goes to scout_events under "locate". */
export async function locateAction(ids: string[] | null): Promise<Result> {
  if (locating.active) return { ok: false, error: "a locate job is already running" };
  const db = await getDb();
  const say = (line: string) => {
    console.log(line);
    void db.collection("scout_events").insertOne({ threadId: "locate", at: new Date(), line });
  };
  locating.active = true;
  void locateMany(db, ids ?? undefined, say)
    .catch((err) => say(`locate failed: ${err instanceof Error ? err.message : err}`))
    .finally(() => {
      locating.active = false;
      say("locate done");
    });
  return { ok: true };
}
