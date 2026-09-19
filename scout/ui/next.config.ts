/**
 * Scout UI: a local-only Next app for scouting, reviewing, and promoting places.
 * Runs with `npm run scout:ui` (localhost:3100). Never part of the Vercel build.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

function repoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "saturday-tickets") return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("saturday-tickets repo root not found");
    dir = up;
  }
}

// Env comes from the repo's .env.local, loaded by lib/env.ts in the server process.
const root = repoRoot(process.cwd());

const config: NextConfig = {
  outputFileTracingRoot: root,
  experimental: { externalDir: true },
  serverExternalPackages: [
    "mongodb",
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/langgraph-checkpoint-mongodb",
    "@anthropic-ai/sdk",
    "@vercel/blob",
  ],
  devIndicators: false,
};

export default config;
