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
  }, true), /judge failed/);
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
