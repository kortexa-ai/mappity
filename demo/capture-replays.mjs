// Captures real answers from the running server, with their real timing, for the static site to play
// back (see "Recorded answers" in public/app.js).   node --env-file=.env demo/capture-replays.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const APP = process.env.MAPPITY_URL || `http://localhost:${process.env.PORT || 4321}`;
const OUT = new URL("../site/replays/", import.meta.url).pathname;
const VIEW = { center: [-122.3421, 47.6097], zoom: 15.6, bbox: [-122.352, 47.604, -122.332, 47.615] }; // Pike Place Market, Seattle
const WISHES = [
  "my kid is melting down and needs sugar immediately",
  "cozy coffee within 5 minutes walk of the aquarium",
  "somewhere I'd feel fine walking to alone at 11pm",
  "I need cash",
];
const SHOWN_ON_MAP = new Set([0, 1, 6]); // street lights, benches, cameras: the only detections the client draws
const LONGEST_WAIT = 900; // ms. A cold OpenStreetMap fetch can take half a minute; nobody needs to relive that.

mkdirSync(OUT, { recursive: true });
const listing = [];
for (const text of WISHES) {
  const res = await fetch(`${APP}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, view: VIEW }) });
  if (!res.ok) throw new Error(`${APP} answered ${res.status}. Is mappity running?`);
  const started = performance.now();
  const events = [];
  let buffer = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter((l) => l.trim())) events.push({ t: performance.now() - started, event: JSON.parse(line) });
  }

  let shift = 0;
  let previous = 0;
  for (const entry of events) {
    const gap = entry.t - previous;
    previous = entry.t;
    if (gap > LONGEST_WAIT) shift += gap - LONGEST_WAIT;
    entry.t = Math.round(entry.t - shift);
    if (entry.event.step === "street" && entry.event.points) entry.event.points = entry.event.points.filter(([, , group]) => SHOWN_ON_MAP.has(group));
  }

  const file = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) + ".json";
  const body = JSON.stringify({ text, view: { center: VIEW.center, zoom: VIEW.zoom }, events });
  writeFileSync(OUT + file, body);
  listing.push({ text, file });
  const done = events.at(-1).event;
  console.log(`${(body.length / 1024).toFixed(0).padStart(5)} KB  ${String(events.length).padStart(3)} events  ${done.judgments} judgments in ${Math.round(done.ms)} ms  "${text}"`);
}
writeFileSync(OUT + "index.json", JSON.stringify(listing, null, 2) + "\n");
