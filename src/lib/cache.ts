import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Draft cache, so redrafting the same question (or rerunning the eval) doesn't spend the daily
 * free-model quota. Kept in memory, and on disk under .cache/drafts when the filesystem is
 * writable (local dev and the eval script; on serverless hosts it silently stays in memory).
 *
 * The key covers everything that changes the output: the product row, the message, the shopper
 * name, the model chain and the prompts. Editing a prompt invalidates old entries automatically.
 */
const DIR = path.join(process.cwd(), ".cache", "drafts");
const memory = new Map<string, unknown>();

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export function readCache<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const value = JSON.parse(readFileSync(path.join(DIR, `${key}.json`), "utf8")) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown) {
  memory.set(key, value);
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path.join(DIR, `${key}.json`), JSON.stringify(value, null, 2));
  } catch {
    // Read-only filesystem: the in-memory copy is enough.
  }
}
