/**
 * Add ids to the signed tag lists in lib/places.ts. Tags stay signed in code: this edits the
 * file, and the person signs by reviewing the diff and committing it.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { Kind } from "../../lib/places";
import { PLACES_TS } from "./paths";

function listName(kind: Kind): string {
  return `SIGNED_${kind.toUpperCase()}_IDS`;
}

function render(name: string, ids: string[]): string {
  const oneLine = `export const ${name} = [${ids.map((id) => `"${id}"`).join(", ")}] as const;`;
  if (oneLine.length <= 110) return oneLine;
  return `export const ${name} = [\n${ids.map((id) => `  "${id}",`).join("\n")}\n] as const;`;
}

/** Returns the ids actually added per kind; already-signed ids are left alone. */
export async function signTags(entries: { id: string; tags: Kind[] }[]): Promise<Record<string, string[]>> {
  let source = await readFile(PLACES_TS, "utf8");
  const added: Record<string, string[]> = {};
  const kinds = new Set(entries.flatMap((e) => e.tags));
  for (const kind of kinds) {
    const name = listName(kind);
    const pattern = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`);
    const match = source.match(pattern);
    if (!match) throw new Error(`${name} not found in lib/places.ts`);
    const ids = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const fresh = entries.filter((e) => e.tags.includes(kind) && !ids.includes(e.id)).map((e) => e.id);
    if (!fresh.length) continue;
    source = source.replace(pattern, render(name, [...ids, ...fresh]));
    added[kind] = fresh;
  }
  if (Object.keys(added).length) await writeFile(PLACES_TS, source);
  return added;
}
