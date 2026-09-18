// Cactus Needle through needle.server: plain words in, a typed tool call out. Local, ~50 ms.
// Contract: ~/src/needle.server/llms.txt (also served at GET /llms.txt).

const NEEDLE_URL = process.env.NEEDLE_URL || "http://localhost:4007";

// Needle only gets crisp commands and hard constraints. It never gets the wish itself:
// it copies spans from the input, and a wish is not a span ("needs sugar" became go_to("sugar")).
// Keep this array byte-identical between requests, so that needle.server stays on a warm engine.
export const TOOLS = [
  {
    name: "go_to",
    description: "Move the map to a named city, neighborhood, landmark or address",
    parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
  },
  {
    name: "zoom",
    description: "Zoom the map in or out",
    parameters: {
      type: "object",
      properties: { direction: { type: "string", enum: ["in", "out"] } },
      required: ["direction"],
    },
  },
  {
    name: "search_near",
    description: "Limit the search to the area around a named landmark, optionally within a walking time",
    parameters: {
      type: "object",
      properties: {
        landmark: { type: "string" },
        max_walk_minutes: { type: "integer", minimum: 1, maximum: 60 },
      },
      required: ["landmark"],
    },
  },
];

/** Returns { calls, confidence, ms }. A Needle outage is not fatal: the map still answers wishes. */
export async function extract(input) {
  const started = performance.now();
  try {
    const res = await fetch(`${NEEDLE_URL}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: input.slice(0, 2000), tools: TOOLS }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`needle ${res.status}`);
    const out = await res.json();
    return {
      calls: out.function_calls ?? [],
      confidence: out.confidence ?? 0,
      worker: out.server?.worker,
      ms: performance.now() - started,
    };
  } catch (error) {
    return { calls: [], confidence: 0, ms: performance.now() - started, error: String(error.message || error) };
  }
}
