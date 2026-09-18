// mappity server: static files, the streaming /api/ask pipeline, and the guessing game.
// The TypeSafe key and the Mapillary token stay here; the browser never sees them.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import * as pipeline from "./pipeline.js";
import * as game from "./game.js";

const PORT = Number(process.env.PORT || 4321);
const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "public");
const VENDOR = join(ROOT, "node_modules/maplibre-gl/dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) throw new Error("request too large");
  }
  return JSON.parse(body || "{}");
}

const sendJson = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

async function serveFile(res, base, path) {
  const file = normalize(join(base, path));
  if (!file.startsWith(base)) return sendJson(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
}

const routes = {
  // Streams newline-delimited JSON: one line per pipeline step, as each step completes.
  "POST /api/ask": async (req, res) => {
    const { text, view } = await readJson(req);
    if (typeof text !== "string" || !text.trim() || !view?.center || !view?.bbox) return sendJson(res, 400, { error: "text and view are required" });
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      await pipeline.run({ text: text.trim().slice(0, 500), view }, emit);
    } catch (error) {
      console.error("ask failed:", error);
      emit({ step: "error", message: String(error.message || error) });
    }
    res.end();
  },
  "POST /api/prefetch": async (req) => pipeline.prefetch((await readJson(req)).view),
  "POST /api/game/start": async (req) => game.start(await readJson(req)),
  "POST /api/game/ask": async (req) => {
    const { id, question } = await readJson(req);
    return game.ask(id, String(question || "").slice(0, 300));
  },
  "POST /api/game/guess": async (req) => {
    const { id, placeId } = await readJson(req);
    return game.guess(id, placeId);
  },
  "POST /api/game/giveup": async (req) => game.giveUp((await readJson(req)).id),
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) {
      const result = await route(req, res);
      if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
      return;
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    if (url.pathname.startsWith("/vendor/")) return serveFile(res, VENDOR, url.pathname.slice("/vendor/".length));
    return serveFile(res, PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
  } catch (error) {
    console.error(`${req.method} ${url.pathname} failed:`, error);
    if (!res.headersSent) sendJson(res, 400, { error: String(error.message || error) });
    else res.end();
  }
}).listen(PORT, () => console.log(`mappity is listening on http://localhost:${PORT}`));
