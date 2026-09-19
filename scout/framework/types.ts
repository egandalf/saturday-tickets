/**
 * The framework's vocabulary. Tools live in code (the only place side effects live); agent
 * definitions live in Atlas and are edited in the UI; every run of an agent is an execution
 * with its own LangGraph thread, audit log, and pause/resume.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { BaseStore } from "@langchain/langgraph";
import type { Db } from "mongodb";
import type { z } from "zod";

/** read: no side effects. stage: writes only to framework memory. write: touches live data, always gated by a person. output: ends the agent's work. */
export type Effect = "read" | "stage" | "write" | "output";

export type Review = "select" | "approve";

export type EventType =
  | "start"
  | "memory_read"
  | "memory_write"
  | "llm_call"
  | "thinking"
  | "text"
  | "tool_call"
  | "tool_result"
  | "nudge"
  | "interrupt"
  | "human"
  | "handoff"
  | "output"
  | "error"
  | "end";

export type ToolContext = {
  db: Db;
  memory: BaseStore;
  executionId: string;
  agent: string;
  input: Record<string, unknown>;
  step: number;
  /** Append an event to this execution's audit log (memory reads/writes, notes). */
  log: (type: EventType, data: Record<string, unknown>) => void;
};

/** What an output tool hands back: final ends the agent's turn loop and pauses for review. */
export type OutputResult<O = unknown> = { final: true; output: O; message: string } | { final: false; message: string };

export type ToolDef<I = any, R = unknown> = {
  name: string;
  description: string;
  effect: Effect;
  input: z.ZodType<I>;
  run: (input: I, ctx: ToolContext) => Promise<R>;
  /** Output tools only: how a person reviews the output, and what approving runs. */
  review?: Review;
  onApprove?: string;
  /** One line for the inbox: what's waiting on the person. */
  summarize?: (output: any) => string;
  /** Select stops: the items a person chooses among; each chosen one is handed off. */
  items?: (output: any) => { id: string; title: string; value: unknown }[];
  /** Approve stops: what rejecting records, so later runs learn from it. */
  onReject?: (output: any, reason: string, ctx: ToolContext) => Promise<void>;
};

export type InputField = {
  name: string;
  label: string;
  type: "string" | "text" | "number" | "json";
  required?: boolean;
  default?: unknown;
  help?: string;
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AgentDefinition = {
  name: string;
  description: string;
  model: string;
  effort: Effort;
  maxTurns: number;
  /** Plain-English instructions: the agent's job, standards, and judgment calls. */
  instructions: string;
  /** Tool names from the library, excluding the output tool. */
  tools: string[];
  /** The output tool that ends the agent's work and shapes the HITL stop. */
  output: string;
  input: InputField[];
  /** For select stops: each selected item becomes an execution of this agent. */
  handoff?: string;
  /** Namespaces recalled at the start, e.g. "lead/{item.id}"; {path} reads from the input. */
  recall: string[];
};

export type AgentVersion = {
  _id: string; // name@version
  name: string;
  version: number;
  definition: AgentDefinition;
  note: string;
  createdAt: Date;
};

export type ExecutionStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export type Waiting =
  | { kind: "select"; summary: string }
  | { kind: "approve"; summary: string; error?: string }
  | { kind: "approve_tool"; summary: string };

export type Execution = {
  _id: string;
  agent: string;
  version: number;
  input: Record<string, unknown>;
  parentId: string | null;
  rootId: string;
  /** The parent's output item this execution works on, for handoffs. */
  itemId: string | null;
  status: ExecutionStatus;
  waiting: Waiting | null;
  outcome: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExecutionEvent = {
  _id: string; // executionId:step:index, so a replayed node never duplicates
  executionId: string;
  step: number;
  index: number;
  at: Date;
  type: EventType;
  data: Record<string, unknown>;
};

/** Human decisions at a stop. */
export type Decision =
  | { kind: "select"; selected: string[]; rejected: { id: string; reason: string }[] }
  | { kind: "approve"; approve: true; payload: Record<string, unknown>; note?: string }
  | { kind: "approve"; approve: false; reason: string }
  | { kind: "approve_tool"; approved: string[] };

export type Memory = {
  text: string;
  source: string | null;
  kind: string;
  executionId: string;
  agent: string;
  step: number;
  at: string;
  [extra: string]: unknown;
};

export type ModelMessage = Anthropic.MessageParam;
