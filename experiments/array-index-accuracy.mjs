import * as jev from "../server/jev.js";
import { placesIn, nearest } from "../server/osm.js";
import { bboxAround } from "../server/geo.js";
const center = [-122.3421, 47.6097];
const places = nearest((await placesIn(bboxAround(center, 611))).value, center, 611, 1500).slice(0, 240);
const FOOD = new Set(["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "food_court", "biergarten"]);
const truth = (p) => FOOD.has(p.kind);
const Q = "a restaurant, cafe, bar, pub, fast food or ice cream place, where food or drinks are served to customers";
const entry = (p) => ({ name: p.name, ...p.tags });

async function run(label, batchSize, build) {
  let right = 0, tokens = 0, ms = 0; const wrong = [];
  const batches = []; for (let i = 0; i < places.length; i += batchSize) batches.push(places.slice(i, i + batchSize));
  await Promise.all(batches.map(async (batch) => {
    const { state, questions } = build(batch);
    const r = await jev.ask(state, questions); tokens += r.tokens; ms = Math.max(ms, r.ms);
    batch.forEach((p, i) => { const yes = r.answers[`p${i}`].noul >= 0.5; if (yes === truth(p)) right++; else wrong.push(`${p.name}(${p.kind})=${r.answers[`p${i}`].noul.toFixed(2)}`); });
  }));
  console.log(`${label.padEnd(28)} batch ${String(batchSize).padStart(3)}: ${right}/${places.length} = ${(100 * right / places.length).toFixed(1)}%  ${tokens} tok  ${ms.toFixed(0)} ms   wrong e.g. ${wrong.slice(0, 4).join(", ")}`);
}
const byIndex = (batch) => ({ state: { places: batch.map(entry) },
  questions: Object.fromEntries(batch.map((_, i) => [`p${i}`, jev.noul(`Is \`places[${i}]\` ${Q}?`)])) });
const byKey = (batch) => ({ state: { places: Object.fromEntries(batch.map((p, i) => [`place_${i}`, entry(p)])) },
  questions: Object.fromEntries(batch.map((_, i) => [`p${i}`, jev.noul(`Is \`places.place_${i}\` ${Q}?`)])) });
const byName = (batch) => ({ state: { places: batch.map(entry) },
  questions: Object.fromEntries(batch.map((p, i) => [`p${i}`, jev.noul(`Is the place named "${p.name}" in \`places\` ${Q}?`)])) });
const inline = (batch) => ({ state: { task: "Judge one place at a time." },
  questions: Object.fromEntries(batch.map((p, i) => [`p${i}`, jev.noul({ question: `Is this place ${Q}?`, place: entry(p) })])) });
for (const size of [15, 30, 60]) {
  await run("array index places[i]", size, byIndex);
  await run("object key places.place_i", size, byKey);
  await run("by name in question", size, byName);
  await run("place inline in question", size, inline);
}
