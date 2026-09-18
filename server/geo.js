// Geometry stays in code: Jev is not a calculator, and Needle only reads words.

const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversine([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** [west, south, east, north] box that contains a circle. */
export function bboxAround([lng, lat], radiusM) {
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLng = dLat / Math.cos(rad(lat));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

// A person walks about 80 m a minute, and streets are about 1.3 times longer than the straight line.
const WALK_M_PER_MIN = 80;
const DETOUR = 1.3;
export const walkMinutes = (metres) => (metres * DETOUR) / WALK_M_PER_MIN;
export const walkRadius = (minutes) => (minutes * WALK_M_PER_MIN) / DETOUR;

/** Web-mercator tile that holds a point. */
export function tileAt([lng, lat], z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2) * n);
  return { z, x, y };
}

/** All tiles at zoom z that touch a box. */
export function tilesIn([w, s, e, n], z) {
  const a = tileAt([w, n], z);
  const b = tileAt([e, s], z);
  const tiles = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({ z, x, y });
  return tiles;
}
