import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBatches, placeRequest, gameRequest } from "../server/judge-batches.js";

test("serial batches preserve input order and stop scheduling after failure", async () => {
  const started = [];
  let active = 0;
  await assert.rejects(mapBatches([0, 1, 2, 3], 1, async ([n]) => {
    started.push(n);
    assert.equal(++active, 1, "local requests must not overlap");
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (n === 1) throw new Error("judge failed");
    return n;
  }, 1), /judge failed/);
  assert.deepEqual(started, [0, 1]);
});

test("hosted batches overlap while retaining their original result order", async () => {
  let active = 0, peak = 0;
  const results = await mapBatches([0, 1, 2, 3, 4], 2, async (batch) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return batch;
  });
  assert.equal(peak, 3);
  assert.deepEqual(results, [[0, 1], [2, 3], [4]]);
});

test("four local requests overlap, preserve order and admit the next batch only when a slot is free", async () => {
  const started = [], release = [];
  const work = mapBatches([0, 1, 2, 3, 4, 5], 1, async ([n]) => {
    started.push(n);
    await new Promise((resolve) => { release[n] = resolve; });
    return n;
  }, 4);
  assert.deepEqual(started, [0, 1, 2, 3]);
  release[3]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  release[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  for (const n of [5, 4, 2, 0]) release[n]();
  assert.deepEqual(await work, [0, 1, 2, 3, 4, 5]);
});

test("a parallel failure stops admission and drains already-started requests", async () => {
  const started = [], release = [];
  let settled = false;
  const work = mapBatches([0, 1, 2, 3, 4, 5], 1, async ([n]) => {
    started.push(n);
    await new Promise((resolve, reject) => { release[n] = n === 1 ? () => reject(new Error("judge failed")) : resolve; });
    return n;
  }, 4);
  const rejected = assert.rejects(work, /judge failed/).then(() => { settled = true; });
  release[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.equal(settled, false);
  for (const n of [0, 2, 3]) release[n]();
  await rejected;
  assert.deepEqual(started, [0, 1, 2, 3]);
});

test("one-place judgments retain street evidence and both narrow questions", () => {
  const p = { id: "p", name: "Cafe", tags: { amenity: "cafe" } };
  const contexts = new Map([["p", { "street lights": "lots" }]]);
  const request = placeRequest("well lit", [p], contexts);
  assert.deepEqual(Object.keys(request.state.places), ["place_0"]);
  assert.deepEqual(request.state.places.place_0.street_view, { "street lights": "lots" });
  assert.deepEqual(Object.keys(request.questions), ["fit0", "street0"]);
  assert.match(request.questions.street0.instructions, /places\.place_0\.street_view/);
  assert.deepEqual(Object.keys(gameRequest("Is it a cafe?", [p], true).questions), ["p0", "askable"]);
  assert.deepEqual(Object.keys(gameRequest("Is it a cafe?", [p]).questions), ["p0"]);
});
