/**
 * Repo paths that work from the CLI and from inside the scout UI's Next bundle, where
 * import.meta.dirname isn't the source directory. Walks up from the working directory.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "saturday-tickets") return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`saturday-tickets repo root not found above ${start}`);
    dir = up;
  }
}

export const REPO_ROOT = findRoot(process.cwd());
export const SCOUT_DATA = join(REPO_ROOT, "scout", "data");
export const PLACES_TS = join(REPO_ROOT, "lib", "places.ts");
