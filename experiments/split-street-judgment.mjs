import * as jev from "../server/jev.js";
import { placesIn, nearest } from "../server/osm.js";
import { streetContext } from "../server/mapillary.js";
import { bboxAround } from "../server/geo.js";
const center = [-122.3421, 47.6097], R = 611;
const places = nearest((await placesIn(bboxAround(center, R))).value, center, R, 1500).slice(0, 100);
const street = await streetContext(places, bboxAround(center, R));
const wish = process.argv[2] || "somewhere I'd feel fine walking to alone at 11pm";
const state = { wish, places: Object.fromEntries(places.map((p, i) => [`place_${i}`, { name: p.name, ...p.tags, street_view: street.contexts[i] }])) };
const qs = {};
places.forEach((_, i) => {
  qs[`fit${i}`] = jev.noul(`Leave the street outside aside. Is \`places.place_${i}\` itself the kind of place that suits someone whose wish is \`wish\`?`,
    "The place itself, by its type and details, suits the wish", "The place itself does not suit the wish");
  qs[`st${i}`] = jev.noul(`\`places.place_${i}.street_view\` lists what street-level photos show within 50 metres. Does that street suit someone whose wish is \`wish\`?`,
    "The street surroundings clearly help with the wish", "The street surroundings do not help, or work against the wish");
});
const half = Math.ceil(places.length / 2);
const r = await jev.ask(state, qs);
const rows = places.map((p, i) => ({ name: p.name, kind: p.kind, fit: r.answers[`fit${i}`].noul, st: r.answers[`st${i}`].noul, sv: street.contexts[i] }));
rows.forEach((x) => (x.p = Math.sqrt(x.fit * x.st)));
rows.sort((a, b) => b.p - a.p);
const stats = (k) => { const v = rows.map((x) => x[k]).sort((a, b) => a - b); return `min ${v[0].toFixed(2)} q25 ${v[Math.floor(v.length / 4)].toFixed(2)} med ${v[Math.floor(v.length / 2)].toFixed(2)} q75 ${v[Math.floor(3 * v.length / 4)].toFixed(2)} max ${v.at(-1).toFixed(2)}`; };
console.log(`"${wish}"  ${r.ms.toFixed(0)}ms ${r.tokens}tok`);
console.log("fit   :", stats("fit")); console.log("street:", stats("st")); console.log("comb  :", stats("p"));
const show = (x) => `  ${x.p.toFixed(2)} (fit ${x.fit.toFixed(2)} st ${x.st.toFixed(2)})  ${x.name} [${x.kind}]  lights:${x.sv["street lights"]} shops:${x.sv["shop signs"]} cams:${x.sv["security cameras"]}`;
console.log("TOP"); rows.slice(0, 8).forEach((x) => console.log(show(x)));
console.log("BOTTOM"); rows.slice(-6).forEach((x) => console.log(show(x)));
