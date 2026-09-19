/** Copy a ticket photo into the Blob store at photos/<id>.jpg, the same path the curated photos use. */
import { readFile } from "node:fs/promises";
import { del, put } from "@vercel/blob";

const UA = "saturday-tickets-scout/0.1 (https://github.com/egandalf/saturday-tickets)";

async function bytes(source: string): Promise<Buffer> {
  if (!/^https?:\/\//.test(source)) return readFile(source);
  const res = await fetch(source, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`photo ${res.status} from ${source}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/jpeg")) throw new Error(`photo is ${type || "unknown type"}, not a JPEG`);
  return Buffer.from(await res.arrayBuffer());
}

/** Source is a URL or a local .jpg path. Returns the public Blob URL. */
export async function storePhoto(id: string, source: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) throw new Error("BLOB_READ_WRITE_TOKEN unset");
  const body = await bytes(source);
  if (body[0] !== 0xff || body[1] !== 0xd8) throw new Error("photo is not a JPEG");
  const blob = await put(`photos/${id}.jpg`, body, {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

export async function deletePhoto(url: string): Promise<void> {
  await del(url);
}
