// Run the real game/client in a child, with isolated place data and a local HTTP judge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, copyFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);

async function play(t, provider, valid) {
  const calls = [];
  let active = 0, peak = 0;
  const judge = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    calls.push(parsed);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const answers = Object.fromEntries(Object.keys(parsed.questions).map((k) => [k, {
      type: "noul", noul: k === "askable" ? (valid ? 0.99 : 0.01) : 0.9,
    }]));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ model: "shingi-27b", answers, usage: { input_tokens: 100, output_tokens: 0 } }));
    active--;
  });
  await new Promise((resolve) => judge.listen(0, "127.0.0.1", resolve));
  t.after(() => { judge.closeAllConnections(); judge.close(); });
  const base = `http://127.0.0.1:${judge.address().port}`;
  const cwd = await mkdtemp(join(tmpdir(), "mappity-game-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "package.json"), '{"type":"module"}');
  await symlink(new URL("../node_modules", import.meta.url).pathname, join(cwd, "node_modules"), "dir");
  for (const file of ["game.js", "jev.js", "judge-batches.js", "geo.js"]) await copyFile(new URL(`../server/${file}`, import.meta.url), join(cwd, file));
  await writeFile(join(cwd, "osm.js"), `
    const places = Array.from({length:8}, (_,i) => ({id:String(i),name:'Cafe '+i,kind:'cafe',tags:{amenity:'cafe',cuisine:'coffee',indoor_seating:'yes'},lng:0,lat:0,metres:i}));
    export const nearest = (p) => p;
    export const placesIn = async () => ({value:places});
  `);
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", `
    const game = await import('./game.js');
    const g = await game.start({center:[0,0],radiusM:100});
    console.log(JSON.stringify(await game.ask(g.id,'Is it a cafe?')));
  `], { cwd, timeout: 10000, env: {
    PATH: process.env.PATH, JEV_PROVIDER: provider, SHINGI_URL: base,
    TYPESAFE_BASE_URL: base, TYPESAFE_API_KEY: "test-key",
  } });
  return { calls, result: JSON.parse(stdout), peak };
}

test("Shingi rejects an invalid game question before asking about any place", async (t) => {
  const { calls, result } = await play(t, "shingi", false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].state, { question: "Is it a cafe?" });
  assert.deepEqual(Object.keys(calls[0].questions), ["askable"]);
  assert.equal(result.askable, false);
  assert.equal(result.judgments, 1);
  assert.equal(result.requests, 1);
});

test("Shingi bills the separate validity check and each isolated place", async (t) => {
  const { calls, result, peak } = await play(t, "shingi", true);
  assert.equal(calls.length, 9);
  assert.equal(peak, 4);
  for (const call of calls.slice(1)) assert.equal(Object.keys(call.state.places).length, 1);
  assert.equal(result.requests, 9);
  assert.equal(result.judgments, 9);
  assert.equal(result.tokens, 900);
  assert.equal(result.usd, 0);
  assert.equal(result.odds.length, 8);
  assert.equal(result.asked, 1);
});

test("Jev retains its single game batch and speculative validity check", async (t) => {
  const { calls, result } = await play(t, "jev", true);
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0].state.places).length, 8);
  assert.equal(Object.keys(calls[0].questions).length, 9);
  assert.equal(result.requests, 1);
  assert.equal(result.tokens, 100);
  assert.ok(result.usd > 0);
});
