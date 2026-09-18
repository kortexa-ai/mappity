// Small disk cache. It keeps us polite to the free OSM services and makes repeat questions instant.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = new URL("../.cache/", import.meta.url).pathname;
const memory = new Map();

const fileFor = (key) => join(DIR, createHash("sha1").update(key).digest("hex") + ".json");

/** The cached value for key if it is younger than ttlMs, else undefined. */
export async function get(key, ttlMs) {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  try {
    const disk = JSON.parse(await readFile(fileFor(key), "utf8"));
    if (now - disk.at >= ttlMs) return undefined;
    memory.set(key, disk);
    return disk.value;
  } catch {
    return undefined; // no usable file
  }
}

export async function set(key, value) {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  await mkdir(DIR, { recursive: true });
  await writeFile(fileFor(key), JSON.stringify(entry));
}

/** Return the cached value for key, or run load() and keep its result for ttlMs. */
export async function cached(key, ttlMs, load) {
  const hit = await get(key, ttlMs);
  if (hit !== undefined) return { value: hit, cached: true };
  const value = await load();
  await set(key, value);
  return { value, cached: false };
}
