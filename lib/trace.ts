export const SYSTEMS = [
  "VOYAGE",
  "ATLAS",
  "GEMINI",
  "FILTER",
  "DEAL",
  "VERCEL",
  "BLOB",
  "CLIENT",
] as const;

export type Sys = (typeof SYSTEMS)[number];

export type DealCall = {
  sys: Sys;
  scope: string;
  fields?: Record<string, unknown>;
};

const PREFIX: Record<string, Sys> = {
  voyage: "VOYAGE",
  mongo: "ATLAS",
  retrieve: "ATLAS",
  gemini: "GEMINI",
  filter: "FILTER",
  deal: "DEAL",
  load: "DEAL",
  http: "VERCEL",
  page: "VERCEL",
};

export function systemOf(scope: string): Sys {
  const prefix = scope.split(".")[0] ?? "";
  return PREFIX[prefix] ?? "DEAL";
}

export const SYS_COLOR: Record<Sys, string> = {
  VOYAGE: "#bb9af7",
  ATLAS: "#2ac3de",
  GEMINI: "#ffac00",
  FILTER: "#e0af68",
  DEAL: "#9ece6a",
  VERCEL: "#7aa2f7",
  BLOB: "#c0caf5",
  CLIENT: "#9a9a9a",
};

export const SYS_ANSI: Record<Sys, string> = {
  VOYAGE: "\x1b[35m",
  ATLAS: "\x1b[36m",
  GEMINI: "\x1b[33m",
  FILTER: "\x1b[93m",
  DEAL: "\x1b[32m",
  VERCEL: "\x1b[34m",
  BLOB: "\x1b[37m",
  CLIENT: "\x1b[90m",
};
