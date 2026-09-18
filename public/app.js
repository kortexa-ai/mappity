// mappity client. The server streams what each model decided; this file turns that into light.

// Every path is relative, so the same files work at / on the local server and under /mappity/app/ on GitHub Pages.
import { Map as MapLibreMap, Marker, Popup, NavigationControl } from "./vendor/maplibre-gl.mjs";

const START = { center: [-122.3421, 47.6097], zoom: 15.6 }; // Pike Place Market, Seattle
const IDEAS = [
  "my kid is melting down and needs sugar immediately",
  "cozy coffee within 5 minutes walk of the aquarium",
  "somewhere I'd feel fine walking to alone at 11pm",
  "take me to Ballard",
  "let's play a guessing game",
];

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const percent = (p) => `${Math.round(p * 100)}%`;
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const usd = (v) => `$${v.toFixed(v < 0.0001 ? 6 : v < 0.01 ? 4 : 2)}`;
const walk = (metres) => `${Math.max(1, Math.round((metres * 1.3) / 80))} min walk`;

// ---------------------------------------------------------------------------------------------
// Map

const map = new MapLibreMap({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: START.center,
  zoom: START.zoom,
  attributionControl: { compact: true, customAttribution: "Street detections © Mapillary" },
  fadeDuration: 150,
  cooperativeGestures: window.self !== window.top, // embedded in a page: do not steal its scroll wheel
});
map.addControl(new NavigationControl({ showCompass: false }), "top-right");
window.mappity = { map }; // handy in the console; the demo recorder reads it too

// Probability to light. Amber for wishes; the game borrows the same layers in a colder hue.
const RAMPS = {
  wish: ["#5b6472", "#8a5a22", "#f08c1e", "#ffc85a", "#fff4d2"],
  game: ["#4c5a66", "#1f6f78", "#22b8c4", "#7de8ee", "#e6fdff"],
};
const ramp = (colors) => ["interpolate", ["linear"], ["get", "p"], 0, colors[0], 0.3, colors[1], 0.55, colors[2], 0.8, colors[3], 1, colors[4]];
const heat = (c) => ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, c[1] + "55", 0.5, c[2] + "99", 0.8, c[3] + "cc", 1, c[4] + "ee"];
// MapLibre wants "zoom" outermost, so the zoom curve wraps the size expression, not the other way round.
const byZoom = (size) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, ["*", 0.35, size], 15, size, 18, ["*", 2.2, size]];

map.on("load", () => {
  const empty = { type: "FeatureCollection", features: [] };
  map.addSource("area", { type: "geojson", data: empty });
  map.addSource("street", { type: "geojson", data: empty });
  map.addSource("places", { type: "geojson", data: empty, promoteId: "id" });
  map.addSource("focus", { type: "geojson", data: empty });

  map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#ffffff", "fill-opacity": 0.035 } });
  map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffffff", "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [2, 3] } });

  // What Mapillary saw on the street: tiny and quiet, so it reads as texture, not as data points.
  map.addLayer({
    id: "street-dots",
    type: "circle",
    source: "street",
    paint: {
      "circle-radius": byZoom(["match", ["get", "g"], 0, 1.3, 1.6]),
      "circle-color": ["match", ["get", "g"], 0, "#ffe9b0", 1, "#8fe3a0", 6, "#ff8f8f", "#9aa3ad"],
      "circle-opacity": ["match", ["get", "g"], 0, 0.5, 0.8],
      "circle-blur": 0.5,
    },
  });

  map.addLayer({
    id: "places-heat",
    type: "heatmap",
    source: "places",
    filter: [">", ["get", "p"], 0.3],
    paint: {
      "heatmap-weight": ["^", ["get", "p"], 3],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.1],
      "heatmap-radius": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 10, 15, 38, 18, 90],
      "heatmap-color": heat(RAMPS.wish),
      "heatmap-opacity": 0.55,
    },
  });
  map.addLayer({
    id: "places-halo",
    type: "circle",
    source: "places",
    filter: [">", ["get", "p"], 0.4],
    layout: { "circle-sort-key": ["get", "p"] },
    paint: {
      "circle-radius": byZoom(["interpolate", ["linear"], ["get", "p"], 0.4, 8, 1, 30]),
      "circle-color": ramp(RAMPS.wish),
      "circle-blur": 1,
      "circle-opacity": ["interpolate", ["linear"], ["get", "p"], 0.4, 0.15, 1, 0.6],
    },
  });
  map.addLayer({
    id: "places-dot",
    type: "circle",
    source: "places",
    layout: { "circle-sort-key": ["get", "p"] },
    paint: {
      "circle-radius": byZoom(["interpolate", ["linear"], ["get", "p"], 0, 2.4, 0.3, 3, 0.6, 5.5, 1, 9]),
      "circle-color": ramp(RAMPS.wish),
      "circle-opacity": ["case", ["==", ["get", "judged"], 1], ["interpolate", ["linear"], ["get", "p"], 0, 0.3, 0.3, 0.55, 0.6, 0.95], 0.4],
      "circle-stroke-color": "#0b0d11",
      "circle-stroke-width": ["interpolate", ["linear"], ["get", "p"], 0, 0, 0.5, 1, 1, 1.5],
    },
  });
  map.addLayer({
    id: "places-label",
    type: "symbol",
    source: "places",
    filter: ["==", ["get", "label"], 1],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["get", "p"], 0.35, 11.5, 1, 14.5],
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-max-width": 9,
      "symbol-sort-key": ["-", 1, ["get", "p"]],
    },
    paint: { "text-color": "#fff4d2", "text-halo-color": "rgba(8,10,14,0.92)", "text-halo-width": 1.6, "text-opacity": ["interpolate", ["linear"], ["get", "p"], 0.2, 0, 0.35, 0.85, 0.8, 1] },
  });
  map.addLayer({
    id: "focus-ring",
    type: "circle",
    source: "focus",
    paint: { "circle-radius": byZoom(15), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-stroke-opacity": 0.95 },
  });

  tuneBasemap();
  map.setPadding(framing());
  map.on("click", "places-dot", (event) => openPlace(event.features[0].properties.id));
  map.on("mouseenter", "places-dot", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "places-dot", () => (map.getCanvas().style.cursor = ""));
  map.on("moveend", schedulePrefetch);
  schedulePrefetch();
  document.body.classList.add("ready");
});

// OpenFreeMap's dark style is neutral grey and nearly black: water and land read the same, and video
// compression turns the streets to mud. Same style, nudged cool and a little brighter.
function tuneBasemap() {
  const paint = {
    background: { "background-color": "#0b0d11" },
    water: { "fill-color": "#08131f" },
    waterway: { "line-color": "#08131f" },
    landuse_residential: { "fill-color": "#0d1015" },
    landcover_wood: { "fill-color": "#0d1a16" },
    landuse_park: { "fill-color": "#0d1a16" },
    building: { "fill-color": "#10141b", "fill-outline-color": "#1a202b" },
    road_area_pier: { "fill-color": "#0d1015" },
    road_pier: { "line-color": "#0d1015" },
    highway_path: { "line-color": "#1b2029" },
    highway_minor: { "line-color": "#20252f" },
    highway_major_inner: { "line-color": "#272d39" },
    highway_major_subtle: { "line-color": "#272d39" },
    highway_motorway_inner: { "line-color": "#2e3542" },
    highway_motorway_subtle: { "line-color": "#2e3542" },
    highway_name_other: { "text-color": "#69717f", "text-halo-color": "#0b0d11" },
    highway_name_motorway: { "text-color": "#69717f" },
    place_other: { "text-color": "#8a92a0" },
    place_suburb: { "text-color": "#8a92a0" },
    water_name: { "text-color": "#3d5166", "text-halo-color": "#08131f" },
  };
  for (const [layer, properties] of Object.entries(paint)) {
    if (!map.getLayer(layer)) continue;
    for (const [name, value] of Object.entries(properties)) map.setPaintProperty(layer, name, value);
  }
}

const currentView = () => {
  const b = map.getBounds();
  const c = map.getCenter();
  return { center: [c.lng, c.lat], bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() };
};

// Room for the panels, so that "the middle of the map" means the middle of what you can see.
// Set once on the map itself: MapLibre keeps any padding passed to easeTo or fitBounds and adds the
// next one on top, which slowly pushes every later view off-centre.
const framing = () => {
  const wide = window.innerWidth > 900;
  // On a phone the results sheet hangs from the top (30vh, see style.css), so the map's middle sits below it.
  return { top: wide ? 90 : Math.round(window.innerHeight * 0.3) + 80, bottom: wide ? 210 : 190, left: wide ? 360 : 20, right: wide ? 400 : 20 };
};
window.addEventListener("resize", () => map.setPadding(framing()));

let prefetchTimer;
function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  if (map.getZoom() < 13.5) return;
  prefetchTimer = setTimeout(() => {
    if (recording) return;
    fetch("api/prefetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: currentView() }) }).catch(() => {});
  }, 700);
}

// ---------------------------------------------------------------------------------------------
// Places: a probability per place, eased toward its target so the map breathes instead of blinking

const places = new Map();
window.mappity.places = places;
let animating = false;

function setPlaces(list) {
  places.clear();
  for (const p of list) places.set(p.id, { ...p, p: 0, target: 0, judged: 0 });
  paint();
}

function setTarget(id, value, judged = 1, factors) {
  const place = places.get(id);
  if (!place) return;
  place.target = value;
  place.judged = judged;
  place.factors = factors;
  if (!animating) requestAnimationFrame(step);
  animating = true;
}

function step() {
  let moving = false;
  for (const place of places.values()) {
    const gap = place.target - place.p;
    if (Math.abs(gap) < 0.004) place.p = place.target;
    else {
      place.p += gap * 0.16;
      moving = true;
    }
  }
  paint();
  animating = moving;
  if (moving) requestAnimationFrame(step);
}

const LABELLED = 12;
function paint() {
  const best = new Set([...places.values()].filter((p) => p.judged && p.target >= 0.35).sort((a, b) => b.target - a.target).slice(0, LABELLED).map((p) => p.id));
  map.getSource("places")?.setData({
    type: "FeatureCollection",
    features: [...places.values()].map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name, p: +p.p.toFixed(3), judged: p.judged, label: best.has(p.id) ? 1 : 0 },
    })),
  });
}

function setMode(mode) {
  document.body.dataset.mode = mode;
  const colors = RAMPS[mode];
  map.setPaintProperty("places-dot", "circle-color", ramp(colors));
  map.setPaintProperty("places-halo", "circle-color", ramp(colors));
  map.setPaintProperty("places-heat", "heatmap-color", heat(colors));
  map.setPaintProperty("places-label", "text-color", colors[4]);
}

function circle([lng, lat], radiusM, points = 96) {
  const ring = [];
  const dLat = (radiusM / 6371008.8) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

let areaLabel;
function showArea(center, radiusM, fly, label, maxZoom = 16.8) {
  const shape = circle(center, radiusM);
  map.getSource("area").setData(shape);
  areaLabel?.remove();
  if (label) {
    // The label rides on the top of the circle, so it says what the circle means.
    const top = shape.geometry.coordinates[0][24];
    areaLabel = new Marker({ element: el("div", "area-label", label), anchor: "bottom" }).setLngLat(top).addTo(map);
  }
  if (!fly) return;
  const lngs = shape.geometry.coordinates[0].map((c) => c[0]);
  const lats = shape.geometry.coordinates[0].map((c) => c[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 24, duration: 1600, maxZoom });
}

const clearSource = (name) => map.getSource(name)?.setData({ type: "FeatureCollection", features: [] });

function focusOn(place) {
  map.getSource("focus").setData(place ? { type: "Feature", geometry: { type: "Point", coordinates: [place.lng, place.lat] }, properties: {} } : { type: "FeatureCollection", features: [] });
}

// ---------------------------------------------------------------------------------------------
// The trace: one row per step, so you can see which model did what, and how fast

const trace = $("trace");
const traceSteps = new Map();

function traceStep(key, who, what, took, tone) {
  let node = traceSteps.get(key);
  if (!node) {
    node = el("li", "step");
    node.dataset.who = who;
    node.append(el("span", "who"), el("span", "what"), el("span", "took mono"));
    trace.append(node);
    $("how").hidden = false;
    traceSteps.set(key, node);
    requestAnimationFrame(() => node.classList.add("in"));
  }
  node.dataset.tone = tone || "";
  node.children[0].textContent = who;
  node.children[1].textContent = what;
  node.children[2].textContent = took == null ? "" : ms(took);
  return node;
}

function resetTrace() {
  trace.replaceChildren();
  traceSteps.clear();
  $("bill").hidden = true;
  $("how").hidden = true;
}

const say = (text, tone = "") => {
  const verdict = $("verdict");
  verdict.hidden = !text;
  verdict.textContent = text || "";
  verdict.dataset.tone = tone;
  verdict.classList.remove("pop");
  void verdict.offsetWidth; // restart the animation
  verdict.classList.add("pop");
};

const callText = (call) => `${call.name}(${Object.values(call.arguments || {}).join(", ")})`;

// ---------------------------------------------------------------------------------------------
// Asking

let busy = false;
let judgedCount = 0;
let judgeMs = 0;
let reasons = new Map();
let streetContexts = null;
let searchCenter = null;

async function ask(text) {
  if (busy || !text.trim()) return;
  if (recording) return replay(text);
  if (game.id) return askGame(text);
  busy = true;
  document.body.classList.add("busy", "asked");
  resetTrace();
  say("");
  judgedCount = 0;
  judgeMs = 0;
  reasons = new Map();
  streetContexts = null;
  closePopup();

  try {
    const res = await fetch("api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, view: currentView() }) });
    if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}.`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) handle(JSON.parse(line), text);
    }
  } catch (error) {
    say(`Something broke: ${error.message}`, "bad");
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

function handle(event, text) {
  switch (event.step) {
    case "needle": {
      const what = event.error ? "offline, carrying on without it" : event.calls.length ? event.calls.map(callText).join(" + ") : "no command in that";
      traceStep("needle", "Needle", what, event.ms, event.error ? "warn" : "");
      break;
    }
    case "route": {
      const kind = { wish: "a wish", map_command: "a map command", play_game: "wants to play", off_topic: "not about places" }[event.kind];
      traceStep("route", "Jev", `${kind}${event.street >= 0.65 ? ", and the street matters" : ""}`, event.ms);
      for (const v of event.verified) traceStep(`claim:${v.value}`, "Jev", `“${v.value}” ${v.ok ? "is a place" : "is not a place"} · ${percent(v.p)}`, null, v.ok ? "good" : "bad");
      if (event.verified.some((v) => !v.ok)) traceSteps.get("needle")?.classList.add("struck");
      break;
    }
    case "command":
      if (event.name === "zoom") map.easeTo({ zoom: map.getZoom() + (event.direction === "in" ? 1 : -1), duration: 700 });
      break;
    case "geocode":
      traceStep("geocode", "Nominatim", event.found ? event.name : `can't find “${event.query}”`, event.ms, event.found ? "" : "bad");
      break;
    case "area":
      searchCenter = event.center;
      if (event.search) {
        traceStep("places", "OpenStreetMap", "looking up what is here…", null, "wait");
        clearResults();
        showArea(event.center, event.radiusM, event.fly, event.name && (event.walkMinutes ? `${event.walkMinutes} min walk from ${event.name}` : `around ${event.name}`));
      } else if (event.fly) {
        clearAll();
        map.flyTo({ center: event.center, zoom: 15.2, duration: 2200 });
        say(`Here's ${event.name}.`);
      }
      break;
    case "places":
      traceStep("places", "OpenStreetMap", `${event.count.toLocaleString()} places${event.cached ? "" : " (fresh from Overpass)"}`, event.ms);
      setPlaces(event.places);
      break;
    case "street":
      if (event.error) {
        traceStep("street", "Mapillary", "unavailable, judging without the street", null, "warn");
        break;
      }
      traceStep("street", "Mapillary", `${event.points.length.toLocaleString()} street lights, benches, cameras and crossings seen nearby`, event.ms);
      streetContexts = event.contexts;
      map.getSource("street").setData({
        type: "FeatureCollection",
        features: event.points
          .filter(([, , g]) => g === 0 || g === 1 || g === 6)
          .map(([lng, lat, g]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { g } })),
      });
      break;
    case "kinds":
      traceStep("kinds", "Jev", `types first: ${event.kinds.slice(0, 3).map((k) => `${k.kind.replaceAll("_", " ")} ${percent(k.p)}`).join(" · ")}`, event.ms);
      break;
    case "judge":
      judgedCount += event.scores.length;
      judgeMs = Math.max(judgeMs, event.ms);
      traceStep("judge", "Jev", event.scores[0]?.[2] ? `${judgedCount} places judged twice: the place, and its street` : `${judgedCount} places judged, one by one`, judgeMs);
      for (const [id, p, factors] of event.scores) setTarget(id, p, 1, factors);
      renderResults();
      break;
    case "explain":
      for (const reason of event.reasons) reasons.set(reason.id, reason.fact);
      renderResults();
      break;
    case "refuse":
      clearAll();
      say(event.reason === "off_topic" ? "I only know about places. Ask me for one." : "I couldn't find that place on the map.", "bad");
      break;
    case "game":
      startGame();
      break;
    case "error":
      say(`Something broke: ${event.message}`, "bad");
      break;
    case "done": {
      const bill = $("bill");
      bill.hidden = false;
      bill.textContent = `${event.judgments.toLocaleString()} judgments · ${event.tokens.toLocaleString()} tokens · ${usd(event.usd)} · ${ms(event.ms)}`;
      if (event.outcome === "searched") summarize();
      if (event.outcome === "empty") say("There's nothing mapped around here yet.", "bad");
      break;
    }
  }
}

const ranked = () => [...places.values()].filter((p) => p.judged).sort((a, b) => b.target - a.target);

function summarize() {
  const [best] = ranked();
  if (!best) return;
  if (best.target >= 0.6) say(`${best.name}. ${percent(best.target)} sure.`);
  else if (best.target >= 0.35) say(`Nothing here is a sure thing. ${best.name} is the best guess at ${percent(best.target)}.`, "warn");
  else say("Honestly, nothing around here fits that.", "bad");
}

function renderResults() {
  const top = ranked().filter((p) => p.target >= 0.3).slice(0, 6);
  $("results").hidden = !top.length;
  const list = $("results-list");
  list.replaceChildren(
    ...top.map((place) => {
      const item = el("li", "result");
      const button = el("button");
      button.type = "button";
      const head = el("div", "result-head");
      head.append(el("span", "name", place.name), el("span", "p mono", percent(place.target)));
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.transform = `scaleX(${place.target.toFixed(3)})`;
      bar.append(fill);
      const meta = el("div", "meta");
      const distance = searchCenter ? walk(place.metres) : "";
      meta.append(el("span", "", [place.kind, distance].filter(Boolean).join(" · ")));
      if (place.factors) meta.append(el("span", "factors mono", `place ${percent(place.factors.fit)} × street ${percent(place.factors.street)}`));
      if (reasons.has(place.id)) meta.append(el("span", "why", reasons.get(place.id)));
      button.append(head, bar, meta);
      button.addEventListener("click", () => openPlace(place.id, true));
      button.addEventListener("mouseenter", () => focusOn(place));
      button.addEventListener("mouseleave", () => focusOn(null));
      item.append(button);
      return item;
    }),
  );
  const rest = ranked().length - top.length;
  $("results-note").textContent = rest > 0 ? `${rest} other places answered too, less convincingly.` : "";
}

function clearResults() {
  $("results").hidden = true;
  clearSource("street");
  focusOn(null);
  closePopup();
}

function clearAll() {
  clearResults();
  clearSource("area");
  areaLabel?.remove();
  places.clear();
  paint();
}

// ---------------------------------------------------------------------------------------------
// One place, up close

let popup;
const closePopup = () => popup?.remove();

function openPlace(id, fly = false) {
  const place = places.get(id);
  if (!place) return;
  closePopup();
  const card = el("div", "card");
  card.append(el("h3", "", place.name));
  card.append(el("p", "kind", place.kind));

  if (game.id) {
    const guess = el("button", "primary", `Is it ${place.name}?`);
    guess.type = "button";
    guess.addEventListener("click", () => guessGame(place));
    card.append(guess);
  } else {
    if (place.judged) card.append(el("p", "score mono", `${percent(place.target)} match${place.factors ? ` = place ${percent(place.factors.fit)} × street ${percent(place.factors.street)}` : ""}`));
    if (reasons.has(place.id)) card.append(el("p", "why", reasons.get(place.id)));
    const facts = el("dl");
    for (const [key, value] of Object.entries(place.tags || {}).slice(0, 7)) facts.append(el("dt", "", key.replaceAll("_", " ")), el("dd", "", String(value).replaceAll("_", " ")));
    card.append(facts);
    const street = streetContexts?.[place.id];
    if (street) {
      const seen = Object.entries(street).filter(([, v]) => v !== "none seen").map(([k, v]) => `${v} ${k}`);
      if (seen.length) card.append(el("p", "street", `On the street: ${seen.join(", ")}.`));
    }
    const link = el("a", "", "Open in OpenStreetMap");
    link.href = `https://www.openstreetmap.org/${place.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    card.append(link);
  }

  popup = new Popup({ offset: 14, closeButton: false, maxWidth: "300px" }).setLngLat([place.lng, place.lat]).setDOMContent(card).addTo(map);
  if (fly) map.easeTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 16.4), duration: 900 });
}

// ---------------------------------------------------------------------------------------------
// The guessing game

const game = { id: null };
const GAME_LIGHT = (relativeOdds) => 0.12 + 0.7 * relativeOdds;
const post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
};

async function startGame() {
  try {
    const view = currentView();
    const [w, s, e] = view.bbox;
    const across = (e - w) * 111320 * Math.cos((s * Math.PI) / 180);
    const started = await post("api/game/start", { center: view.center, radiusM: Math.max(300, Math.min(across / 2.4, 800)) });
    game.id = started.id;
    clearAll();
    resetTrace();
    setMode("game");
    setPlaces(started.places);
    for (const place of started.places) setTarget(place.id, GAME_LIGHT(1), 1);
    showArea(started.center, started.radiusM, true, null, 17.6); // sixty places in two blocks need room
    $("game").hidden = false;
    $("game-log").replaceChildren();
    $("game-count").textContent = `${started.places.length} places, one secret`;
    $("ask").placeholder = "Ask a yes or no question…";
    renderIdeas(["Can I eat there?", "Is it a shop?", "Would a tourist go there?", "Does it serve alcohol?", "Is it fancy?"]);
    say(`I'm thinking of one of these ${started.places.length} places.`);
  } catch (error) {
    say(error.message, "bad");
  }
}

async function askGame(question) {
  busy = true;
  document.body.classList.add("busy");
  try {
    const answer = await post("api/game/ask", { id: game.id, question });
    resetTrace();
    traceStep("game", "Jev", `asked all ${places.size} places that question`, answer.ms);
    const bill = $("bill");
    bill.hidden = false;
    bill.textContent = `${answer.judgments} judgments · ${answer.tokens.toLocaleString()} tokens · ${usd(answer.usd)} · ${ms(answer.ms)}`;
    if (!answer.askable) return say("Ask me something I can answer yes or no.", "warn");

    // In a guessing game "no" is an answer, not a failure: only a murky answer gets a warning colour.
    say(answer.verdict, answer.verdict.startsWith("Hard") ? "warn" : "");
    const most = Math.max(...answer.odds.map(([, o]) => o));
    for (const [id, odds] of answer.odds) setTarget(id, GAME_LIGHT(odds / most));
    const likely = answer.odds.filter(([, o]) => o / most > 0.5).length;
    const entry = el("li");
    entry.append(el("span", "q", question), el("span", "a", answer.verdict));
    $("game-log").prepend(entry);
    $("game-count").textContent = `${answer.asked} asked · ${likely} still likely`;
  } catch (error) {
    say(error.message, "bad");
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

async function guessGame(place) {
  closePopup();
  try {
    const result = await post("api/game/guess", { id: game.id, placeId: place.id });
    if (result.correct) return endGame(result.secret, `Yes! ${result.secret.name}. You needed ${result.asked} question${result.asked === 1 ? "" : "s"}.`, "good");
    say(`Not ${place.name}. Keep asking.`, "bad");
    setTarget(place.id, 0);
  } catch (error) {
    say(error.message, "bad");
  }
}

function endGame(secret, message, tone) {
  game.id = null;
  for (const place of places.values()) setTarget(place.id, place.id === secret.id ? 1 : 0.05);
  focusOn(secret);
  map.easeTo({ center: [secret.lng, secret.lat], zoom: Math.max(map.getZoom(), 16.6), duration: 1400 });
  say(message, tone);
  $("ask").placeholder = "What do you need right now?";
  renderIdeas(IDEAS);
}

$("game-giveup").addEventListener("click", async () => {
  if (!game.id) return;
  const result = await post("api/game/giveup", { id: game.id });
  endGame(result.secret, `It was ${result.secret.name}.`, "warn");
});

$("game-exit").addEventListener("click", () => {
  game.id = null;
  $("game").hidden = true;
  setMode("wish");
  clearAll();
  resetTrace();
  say("");
  $("ask").placeholder = "What do you need right now?";
  renderIdeas(IDEAS);
});

// ---------------------------------------------------------------------------------------------
// The bar

function renderIdeas(list) {
  $("ideas").replaceChildren(
    ...list.map((text) => {
      const button = el("button", "idea", text);
      button.type = "button";
      button.addEventListener("click", () => {
        $("ask").value = text;
        ask(text);
      });
      return button;
    }),
  );
}

$("bar").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("ask");
  ask(input.value);
  input.select();
});

$("results-close").addEventListener("click", () => {
  clearAll();
  resetTrace();
  say("");
  document.body.classList.remove("asked");
});

// The suggestions come back whenever the bar is empty.
$("ask").addEventListener("input", (event) => document.body.classList.toggle("asked", Boolean(event.target.value) && places.size > 0));

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== $("ask")) {
    event.preventDefault();
    $("ask").focus();
  }
  if (event.key === "Escape") closePopup();
});

// ---------------------------------------------------------------------------------------------
// Recorded answers. On a static host (the project's GitHub Pages site) there is no server and no keys,
// so the page plays back real answers captured by demo/capture-replays.mjs, with their real timing.

let recording = null; // { text: file } when this page is a recording

async function replay(text) {
  const file = recording[text.trim().toLowerCase()];
  if (!file) return say("This page is a recording. Pick one of the questions below, or run mappity yourself to ask anything.", "warn");
  busy = true;
  document.body.classList.add("busy", "asked");
  resetTrace();
  say("");
  judgedCount = 0;
  judgeMs = 0;
  reasons = new Map();
  streetContexts = null;
  closePopup();
  try {
    const take = await (await fetch(file)).json();
    // The answer was computed for one view of the map: go there first.
    map.jumpTo({ center: take.view.center, zoom: take.view.zoom });
    const started = performance.now();
    for (const { t, event } of take.events) {
      const wait = t - (performance.now() - started);
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      handle(event, text);
    }
  } catch (error) {
    say(`The recording did not load: ${error.message}`, "bad");
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

document.body.dataset.mode = "wish";
const listing = await fetch("replays/index.json").then((res) => (res.ok ? res.json() : null)).catch(() => null);
if (listing) {
  recording = Object.fromEntries(listing.map((take) => [take.text.toLowerCase(), `replays/${take.file}`]));
  document.body.classList.add("recording");
  $("ask").placeholder = "Pick a recorded question below";
  renderIdeas(listing.map((take) => take.text));
} else {
  renderIdeas(IDEAS);
}
$("ask").focus();
