import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Storage abstraction with two backends:
 *  - Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (serverless / Vercel).
 *  - Local filesystem under downloads/, otherwise (local dev with caw).
 *
 * Keys are slash-separated paths, e.g. "web3-illegal-employment/content.md"
 * or "activity.json". They map to blob pathnames or to downloads/<key> on disk.
 */

const DOWNLOAD_ROOT = "downloads";

export function usingBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function fsPath(key: string): string {
  return join(process.cwd(), DOWNLOAD_ROOT, key);
}

export async function putObject(
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  if (usingBlob()) {
    const { put } = await import("@vercel/blob");
    // Paid report content (and the history/activity manifests that enumerate
    // it) must NOT be world-readable. Store as private blobs; reads go through
    // get() with the read-write token, served only via our route handlers.
    await put(key, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return;
  }

  const path = fsPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

/** Returns the object bytes, or null when the key does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  if (usingBlob()) {
    const { get } = await import("@vercel/blob");
    try {
      const result = await get(key, { access: "private", useCache: false });
      if (!result) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  try {
    return await readFile(fsPath(key));
  } catch {
    return null;
  }
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const bytes = await getObject(key);
  if (!bytes) return fallback;
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await putObject(key, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
}
