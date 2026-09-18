import test from "node:test";
import assert from "node:assert/strict";
import { bboxAround, haversine, tileAt, tilesIn, walkMinutes, walkRadius } from "../server/geo.js";
import { nearest } from "../server/osm.js";

const PIKE_PLACE = [-122.3421, 47.6097];
const AQUARIUM = [-122.3432, 47.6076];

test("haversine: Pike Place to the aquarium is a short walk", () => {
  const metres = haversine(PIKE_PLACE, AQUARIUM);
  assert.ok(metres > 200 && metres < 280, `${metres} m`);
  assert.equal(haversine(PIKE_PLACE, PIKE_PLACE), 0);
});

test("bboxAround contains its circle and is wider in longitude than in latitude", () => {
  const [w, s, e, n] = bboxAround(PIKE_PLACE, 500);
  assert.ok(Math.abs(haversine(PIKE_PLACE, [PIKE_PLACE[0], n]) - 500) < 1);
  assert.ok(Math.abs(haversine(PIKE_PLACE, [e, PIKE_PLACE[1]]) - 500) < 1);
  assert.ok(e - w > n - s, "a degree of longitude is shorter than a degree of latitude at 47 N");
});

test("walking minutes and walking radius are inverses", () => {
  assert.ok(Math.abs(walkMinutes(walkRadius(5)) - 5) < 1e-9);
  assert.ok(walkRadius(5) > 250 && walkRadius(5) < 350, "five minutes is about 300 m as the crow flies");
});

test("tiles: the z14 tile that holds Pike Place, and a box that spans two tiles", () => {
  assert.deepEqual(tileAt(PIKE_PLACE, 14), { z: 14, x: 2624, y: 5721 }); // row 5721 spans 47.6062 to 47.6210 N
  const tiles = tilesIn([-122.36, 47.605, -122.33, 47.612], 14);
  assert.ok(tiles.length >= 2 && tiles.every((t) => t.z === 14));
});

test("nearest keeps places inside the radius, closest first, up to the limit", () => {
  const places = [
    { id: "far", lng: -122.3, lat: 47.65 },
    { id: "aquarium", lng: AQUARIUM[0], lat: AQUARIUM[1] },
    { id: "here", lng: PIKE_PLACE[0], lat: PIKE_PLACE[1] },
  ];
  assert.deepEqual(nearest(places, PIKE_PLACE, 1000, 10).map((p) => p.id), ["here", "aquarium"]);
  assert.deepEqual(nearest(places, PIKE_PLACE, 1000, 1).map((p) => p.id), ["here"]);
});
