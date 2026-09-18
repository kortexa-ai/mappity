// Mapillary: what the street actually looks like, as machine detections from street-level photos.
// Jev reads text only, so the street enters as words ("street lights: lots"), never as pixels.
//
// We read the map-feature vector tiles, not the Graph API: /images?bbox= answers HTTP 500 in dense
// areas, and one z14 tile holds everything we need (about 200,000 detections for downtown Seattle).

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { cached } from "./cache.js";
import { haversine, tilesIn } from "./geo.js";

const TOKEN = process.env.MAPILLARY_ACCESS_TOKEN;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const ZOOM = 14;
const NEARBY_M = 50;

// Detection classes folded into the few things a person would notice about a street.
const GROUPS = {
  "street lights": ["object--street-light"],
  benches: ["object--bench"],
  "pedestrian crossings": ["marking--discrete--crosswalk-zebra", "object--traffic-light--pedestrians-"],
  "bike racks": ["object--bike-rack"],
  "shop signs": ["object--sign--store", "object--sign--advertisement", "object--banner"],
  "construction barriers": ["construction--barrier--temporary", "object--traffic-cone", "object--traffic-sign--temporary-"],
  "security cameras": ["object--cctv-camera"],
};
export const GROUP_NAMES = Object.keys(GROUPS);

const groupOf = (value) => GROUP_NAMES.findIndex((g) => GROUPS[g].some((prefix) => value.startsWith(prefix)));

async function loadTile({ z, x, y }) {
  const { value } = await cached(`mapillary:${z}/${x}/${y}`, WEEK, async () => {
    const url = `https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/${z}/${x}/${y}?access_token=${TOKEN}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (res.status === 204 || res.status === 404) return [];
    if (!res.ok) throw new Error(`mapillary ${res.status}`);
    const layer = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.point;
    if (!layer) return [];

    // The same lamp is detected again every time someone drives past. Keep one per ~6 m cell.
    const seen = new Set();
    const points = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const group = groupOf(feature.properties.value);
      if (group < 0) continue;
      const [lng, lat] = feature.toGeoJSON(x, y, z).geometry.coordinates;
      const cell = `${group}|${Math.round(lat / 0.00005)}|${Math.round(lng / 0.00008)}`;
      if (seen.has(cell)) continue;
      seen.add(cell);
      points.push([+lng.toFixed(6), +lat.toFixed(6), group]);
    }
    return points;
  });
  return value;
}

// Four words, ranked against the other candidates. Raw counts would mostly measure how often
// someone drove past with a camera, and Jev is better with words than with numbers anyway.
function words(counts) {
  const seenSomewhere = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const at = (q) => seenSomewhere[Math.floor(q * (seenSomewhere.length - 1))] ?? 0;
  const low = at(0.25);
  const high = at(0.75);
  return counts.map((c) => (c === 0 ? "none seen" : c >= high && high > low ? "lots" : c <= low ? "few" : "some"));
}

/**
 * Street context for each place: { "street lights": "lots", benches: "none seen", ... }.
 * Returns { contexts, points, ms } where points are the detections near the places, for the map.
 */
export async function streetContext(places, bbox) {
  const started = performance.now();
  if (!TOKEN) throw new Error("MAPILLARY_ACCESS_TOKEN is not set");
  const points = (await Promise.all(tilesIn(bbox, ZOOM).map(loadTile))).flat();

  // Bucket the detections into ~55 m cells, so each place only looks at its own neighbourhood.
  const cellOf = (lng, lat) => `${Math.floor(lat / 0.0005)}|${Math.floor(lng / 0.0007)}`;
  const grid = new Map();
  for (const point of points) {
    const key = cellOf(point[0], point[1]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(point);
  }

  const near = new Set();
  const counts = places.map((place) => {
    const tally = new Array(GROUP_NAMES.length).fill(0);
    const row = Math.floor(place.lat / 0.0005);
    const col = Math.floor(place.lng / 0.0007);
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        for (const point of grid.get(`${r}|${c}`) ?? []) {
          if (haversine([place.lng, place.lat], point) > NEARBY_M) continue;
          tally[point[2]]++;
          near.add(point);
        }
      }
    }
    return tally;
  });

  const byGroup = GROUP_NAMES.map((_, g) => words(counts.map((tally) => tally[g])));
  const contexts = places.map((_, i) => Object.fromEntries(GROUP_NAMES.map((name, g) => [name, byGroup[g][i]])));
  return { contexts, points: [...near], detections: points.length, ms: performance.now() - started };
}
