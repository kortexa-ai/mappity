// OpenStreetMap: Overpass for the places, Nominatim for "where is the aquarium".
// Both are free community services: identify ourselves, cache hard, never hammer.

import * as cache from "./cache.js";
import { haversine } from "./geo.js";

// The OSM usage policies ask every client to say who it is. Set OSM_CONTACT to a URL or an address
// where the operators can reach you; by default we point at the project.
const USER_AGENT = `mappity/0.1 (+${process.env.OSM_CONTACT || "https://github.com/kortexa-ai/mappity"})`;
const DAY = 24 * 60 * 60 * 1000;

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Useful places that mappers usually leave unnamed. Everything else needs a name.
const UNNAMED_OK = {
  toilets: "Public toilets",
  drinking_water: "Drinking water",
  viewpoint: "Viewpoint",
  playground: "Playground",
  picnic_table: "Picnic table",
  shelter: "Shelter",
};

// Street furniture and car plumbing: never the answer to a wish.
const BORING = new Set([
  "parking", "parking_entrance", "parking_space", "bicycle_parking", "motorcycle_parking", "charging_station",
  "vending_machine", "waste_basket", "recycling", "bench", "post_box", "telephone", "clock", "fire_station",
  "loading_dock", "bicycle_repair_station", "car_sharing", "taxi", "information", "pitch", "swimming_pool",
  "yes", "no", "fixme", "vacant", // mappers' placeholders, not place types
]);

// Tags that tell Jev nothing about what a place is like. Less irrelevant state means better judgments.
const NOISE = [
  "addr:", "source", "website", "phone", "contact:", "ref", "wikidata", "wikipedia", "check_date", "brand:",
  "email", "fax", "image", "mapillary", "survey", "name:", "payment:", "operator:", "gnis:", "created_by",
  "note", "fixme", "FIXME", "old_name", "alt_name", "short_name", "official_name", "url", "facebook",
  "instagram", "twitter", "start_date", "height", "building", "roof:", "layer", "level", "ele", "currency:",
  "toilets:position", "opening_hours:", "was:", "disused:", "not:", "branch", "loc_name",
];

function cleanTags(tags) {
  const out = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "name" || NOISE.some((prefix) => key.startsWith(prefix))) continue;
    out[key] = String(value).slice(0, 80);
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

function toPlace(el) {
  const tags = el.tags || {};
  const kind = tags.amenity || tags.shop || tags.tourism || tags.leisure;
  if (!kind || BORING.has(kind)) return null;
  const name = tags.name || UNNAMED_OK[kind];
  if (!name) return null;
  const lng = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (lng == null || lat == null) return null;
  return { id: `${el.type}/${el.id}`, name, kind, lng, lat, tags: cleanTags(tags) };
}

async function overpass(query) {
  let lastError;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Places are cached in fixed grid tiles (about 1.1 km x 0.75 km at Seattle's latitude), so a pan or
// a new landmark reuses what is already known. Only the missing tiles go to Overpass, in one query.
const TILE = 0.01;
const tileKey = (ix, iy) => `places:v2:${ix}:${iy}`;

function tilesOf([w, s, e, n]) {
  const tiles = [];
  for (let ix = Math.floor(w / TILE); ix <= Math.floor(e / TILE); ix++)
    for (let iy = Math.floor(s / TILE); iy <= Math.floor(n / TILE); iy++) tiles.push([ix, iy]);
  return tiles;
}

// One Overpass query at a time: the public servers give each address two slots and punish bursts.
let queue = Promise.resolve();
const serial = (work) => {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
};

async function fetchTiles(tiles) {
  const xs = tiles.map(([ix]) => ix);
  const ys = tiles.map(([, iy]) => iy);
  const [w, s, e, n] = [Math.min(...xs) * TILE, Math.min(...ys) * TILE, (Math.max(...xs) + 1) * TILE, (Math.max(...ys) + 1) * TILE];
  const data = await overpass(`[out:json][timeout:25];
nwr[~"^(amenity|shop|tourism|leisure)$"~"."](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
out center tags 8000;`);

  const byTile = new Map();
  const seen = new Set();
  for (const el of data.elements) {
    const place = toPlace(el);
    // The same shop is often mapped as both a node and a building outline.
    const dedupe = place && `${place.name}|${place.kind}|${place.lat.toFixed(4)}|${place.lng.toFixed(4)}`;
    if (!place || seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = tileKey(Math.floor(place.lng / TILE), Math.floor(place.lat / TILE));
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(place);
  }
  // The query covered the whole rectangle around the missing tiles: keep all of it, empty tiles too.
  for (let ix = Math.min(...xs); ix <= Math.max(...xs); ix++)
    for (let iy = Math.min(...ys); iy <= Math.max(...ys); iy++) await cache.set(tileKey(ix, iy), byTile.get(tileKey(ix, iy)) ?? []);
}

/** Places of interest inside a [w, s, e, n] box. Returns { value, cached }. */
export async function placesIn(bbox) {
  const tiles = tilesOf(bbox);
  const missing = async () => {
    const found = await Promise.all(tiles.map(([ix, iy]) => cache.get(tileKey(ix, iy), DAY)));
    return tiles.filter((_, i) => found[i] === undefined);
  };

  let wasCached = true;
  if ((await missing()).length) {
    wasCached = false;
    await serial(async () => {
      const still = await missing(); // a prefetch may have filled them while we waited
      if (still.length) await fetchTiles(still);
    });
  }
  const loaded = await Promise.all(tiles.map(([ix, iy]) => cache.get(tileKey(ix, iy), DAY)));
  const [w, s, e, n] = bbox;
  const value = loaded.flat().filter((p) => p && p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n);
  return { value, cached: wasCached };
}

/** The `limit` places nearest to `center`, within `radiusM`. */
export function nearest(places, center, radiusM, limit) {
  return places
    .map((p) => ({ ...p, metres: haversine(center, [p.lng, p.lat]) }))
    .filter((p) => p.metres <= radiusM)
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

/** Geocode free text, preferring results near the current view. Returns null when nothing matches. */
export async function geocode(text, viewBbox) {
  const params = new URLSearchParams({ q: text, format: "jsonv2", limit: "1" });
  if (viewBbox) {
    // A generous box around the view: "the aquarium" should mean the one in this city.
    const [w, s, e, n] = viewBbox;
    const pad = 0.25;
    params.set("viewbox", [w - pad, n + pad, e + pad, s - pad].join(","));
  }
  const key = `geocode:${params}`;
  const { value, cached: wasCached } = await cache.cached(key, 30 * DAY, async () => {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const [hit] = await res.json();
    if (!hit) return null;
    const [s, n, w, e] = hit.boundingbox.map(Number);
    return { name: hit.name || hit.display_name.split(",")[0], label: hit.display_name, lng: +hit.lon, lat: +hit.lat, bbox: [w, s, e, n] };
  });
  return value && { ...value, cached: wasCached };
}
