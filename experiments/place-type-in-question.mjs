import * as jev from "../server/jev.js";
import { placesIn, nearest } from "../server/osm.js";
import { bboxAround } from "../server/geo.js";
const center = [-122.3421, 47.6097];
const places = nearest((await placesIn(bboxAround(center, 611))).value, center, 611, 1500);
const kinds = [...new Set(places.map((p) => p.kind))].map((k) => k.replaceAll("_", " "));
for (const wish of ["my kid is melting down and needs sugar immediately", "somewhere to sit with a hot drink and watch the rain", "I need cash", "somewhere I'd feel fine walking to alone at 11pm"]) {
  const r = await jev.ask({ wish }, Object.fromEntries(kinds.map((k, i) => [`k${i}`,
    jev.noul(`Could a place of the type "${k}" be a good place to go for someone whose wish is \`wish\`?`,
      "Yes: places of this type can offer what the wish asks for", "No: places of this type do not offer what the wish asks for")])));
  const ranked = kinds.map((k, i) => [k, r.answers[`k${i}`].noul]).sort((a, b) => b[1] - a[1]);
  console.log(`\n"${wish}" ${r.ms.toFixed(0)}ms ${r.tokens}tok`);
  console.log("  top:", ranked.slice(0, 14).map(([k, p]) => `${k}:${p.toFixed(2)}`).join("  "));
  console.log("  bottom:", ranked.slice(-8).map(([k, p]) => `${k}:${p.toFixed(2)}`).join("  "));
  console.log("  >0.5:", ranked.filter(([, p]) => p > 0.5).length, " >0.2:", ranked.filter(([, p]) => p > 0.2).length, " >0.1:", ranked.filter(([, p]) => p > 0.1).length, "of", kinds.length);
}
