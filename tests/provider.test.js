// Regression tests for the judging-model client: server/jev.js must answer identically for both
// providers, and must never let the `usd`/`tokens` fields go missing or undefined — the client's
// bill line in public/app.js calls toFixed on `usd` and would throw on undefined.
//
// No live model is contacted: each test points the client at a throwaway HTTP server that
// replays the exact /v1/systemone contract (both providers serve the same one).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

/** A /v1/systemone-shaped answer for whatever was asked, recording each request body. */
function stubJudge(t, { status = 200, answers = null, record = [] } = {}) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        record.push({ path: req.url, body: parsed, auth: req.headers.authorization });
        if (status !== 200) return res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ detail: "too many questions" }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answers ?? { model: "shingi-27b", answers: { p0: { type: "noul", noul: 0.75 } }, usage: { input_tokens: 1000, output_tokens: 0 } }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

// jev.js builds its client at import time, so each mode gets a fresh module instance (the query
// string defeats the ESM module cache) and a fresh environment.
async function loadJudge(t, mode, base, extraEnv = {}) {
  Object.assign(process.env, { JEV_PROVIDER: mode, SHINGI_URL: base, SHINGI_MODEL: "shingi-27b", TYPESAFE_BASE_URL: base, TYPESAFE_API_KEY: "test-key", ...extraEnv });
  return import(`../server/jev.js?test=${t.name.replace(/\W/g, "_")}`);
}

test("shingi mode posts {model, state, questions} and bills nothing", async (t) => {
  const record = [];
  const base = await stubJudge(t, { record });
  const jev = await loadJudge(t, "shingi", base);

  const asked = await jev.ask({ wish: "somewhere to sit with a hot drink" }, { p0: jev.noul("Would `places.place_0` suit `wish`?") });

  assert.equal(record[0].path, "/v1/systemone");
  assert.deepEqual(Object.keys(record[0].body).sort(), ["model", "questions", "state"]);
  assert.equal(record[0].body.model, "shingi-27b", "SHINGI_MODEL must select the model");
  assert.equal(record[0].body.questions.p0.instructions, "Would `places.place_0` suit `wish`?");
  assert.equal(asked.model, "shingi-27b");
  assert.equal(asked.answers.p0.noul, 0.75);
  assert.equal(asked.tokens, 1000, "token counts drive the bill line");
  assert.equal(asked.usd, 0, "a local model must never invent a dollar cost");
});

test("shingi mode keeps a choice answer's choice and confidence", async (t) => {
  const answers = {
    why0: { type: "choice", choice: "amenity: cafe", probabilities: { "amenity: cafe": 0.9898, "its name": 0.0102 }, confidence: 0.9797 },
  };
  const base = await stubJudge(t, { answers: { model: "shingi-27b", answers, usage: { input_tokens: 1000, output_tokens: 0 } } });
  const jev = await loadJudge(t, "shingi", base);

  const asked = await jev.ask({ wish: "x" }, { why0: jev.choice("Which fact explains it?", { "amenity: cafe": null, "its name": null }) });

  assert.equal(asked.answers.why0.choice, "amenity: cafe");
  assert.ok(asked.answers.why0.confidence > 0.9, "explain() filters on confidence");
});

test("shingi mode turns a refused request into an error, not undefined answers", async (t) => {
  const base = await stubJudge(t, { status: 422 });
  const jev = await loadJudge(t, "shingi", base);

  await assert.rejects(() => jev.ask({ wish: "x" }, { p0: jev.noul("Would it?") }), /422/);
});

test("jev mode keeps billing per input token", async (t) => {
  const record = [];
  const base = await stubJudge(t, { record });
  const jev = await loadJudge(t, "jev", base);

  const asked = await jev.ask({ wish: "x" }, { p0: jev.noul("Would it?") });

  assert.equal(record[0].auth, "Bearer test-key", "the SDK must authenticate against TYPESAFE_BASE_URL");
  assert.ok(asked.usd > 0, "hosted Jev bills by input token");
  assert.ok(asked.usd < 0.01, "one thousand tokens are a fraction of a cent");
});

test("an unknown provider name fails loudly", async (t) => {
  const base = await stubJudge(t);
  await assert.rejects(() => loadJudge(t, "shingi-not", base), /JEV_PROVIDER/);
});
