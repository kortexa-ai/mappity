// Fixed useful work, real application request builders, full inputs and incremental results.
// No credentials, model changes, service restarts or calibration fitting.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { placeRequest, gameRequest, askableQuestion } from "../server/judge-batches.js";

const { values } = parseArgs({ options: {
  out: { type: "string" }, rounds: { type: "string", default: "2" },
  sizes: { type: "string", default: "1,2,5,10,25,50" },
  workloads: { type: "string", default: "quality,game,search" },
} });
if (!values.out) throw new Error("Pass --out <directory> to preserve inputs and results.");
const rounds = Number(values.rounds);
const sizes = values.sizes.split(",").map(Number);
if (!Number.isInteger(rounds) || rounds < 1 || sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 60)) throw new Error("Invalid rounds or batch sizes");
const workloads = values.workloads.split(",");
if (workloads.some((w) => !["quality", "game", "search"].includes(w))) throw new Error("Unknown workload");
const base = (process.env.SHINGI_URL || "http://192.168.2.3:2068").replace(/\/+$/, "");
const model = process.env.SHINGI_MODEL || "shingi-27b";
const bytes = await readFile(new URL("./fixtures/shingi-places.json", import.meta.url));
const fixture = JSON.parse(bytes);
await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "fixture.json"), bytes);
const metadata = await fetch(`${base}/v1/version`, { signal: AbortSignal.timeout(10000) }).then(async (r) => {
  if (!r.ok) throw new Error(`version ${r.status}`);
  return r.json();
});
const report = {
  started: new Date().toISOString(), endpoint: base, model, version: metadata,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
  method: "Fixed places and questions per workload; serial HTTP requests; one warmup; forward/reverse batch-size sweeps. Wall time includes transport and any external queue. Token usage is logical input, not executed prefill. Labels are diagnostics, not calibration ground truth.",
  runs: [], askable: [], concurrency: [],
};
const save = () => writeFile(join(values.out, "results.json"), JSON.stringify(report, null, 2) + "\n");

async function post(request) {
  const body = { model, ...request };
  const started = performance.now();
  const r = await fetch(`${base}/v1/systemone`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`Shingi ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const result = await r.json();
  for (const key of Object.keys(body.questions)) {
    const p = result.answers?.[key]?.noul;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Invalid answer ${key}`);
  }
  return { body, result, wallMs: performance.now() - started };
}

function metrics(scores, labels) {
  if (!labels) return null;
  const ids = Object.keys(labels);
  return {
    n: ids.length,
    errors: ids.filter((id) => (scores[id] >= 0.5 ? 1 : 0) !== labels[id]),
    brier: ids.reduce((sum, id) => sum + (scores[id] - labels[id]) ** 2, 0) / ids.length,
  };
}

try {
  await post(placeRequest(fixture.searchWish, fixture.places.slice(0, 1)));
  for (const workload of workloads) {
    const places = workload === "quality" ? fixture.qualityPlaces : fixture.places;
    const labels = workload === "quality" ? Object.fromEntries(places.map((p) => [p.id, p.expected])) : workload === "game" ? fixture.gameLabels : null;
    for (let round = 0; round < rounds; round++) {
      for (const size of round % 2 ? sizes.toReversed() : sizes) {
        const requests = [], scores = {};
        const started = performance.now();
        for (let i = 0; i < places.length; i += size) {
          const batch = places.slice(i, i + size);
          const request = workload === "game" ? gameRequest(fixture.gameQuestion, batch) : placeRequest(workload === "quality" ? fixture.qualityWish : fixture.searchWish, batch);
          const response = await post(request);
          batch.forEach((p, j) => { scores[p.id] = response.result.answers[`p${j}`].noul; });
          requests.push(response);
        }
        const wallMs = performance.now() - started;
        const run = { workload, round: round + 1, size, places: places.length, wallMs, scores, metrics: metrics(scores, labels), requests };
        report.runs.push(run);
        await save();
        console.log(JSON.stringify({ workload, round: round + 1, size, seconds: +(wallMs / 1000).toFixed(3), errors: run.metrics?.errors.length ?? null }));
      }
    }
  }
  for (const sample of fixture.askableCases) {
    const response = await post({ state: { question: sample.question }, questions: { askable: askableQuestion() } });
    report.askable.push({ ...sample, ...response, accepted: response.result.answers.askable.noul >= 0.4 });
  }
  // Same distinct short requests, same order and workload; concurrency is varied, not state size.
  const singles = fixture.places.slice(0, 8).map((p) => gameRequest(fixture.gameQuestion, [p]));
  for (const concurrency of [1, 4, 4, 1]) {
    const requests = [], started = performance.now();
    for (let i = 0; i < singles.length; i += concurrency) requests.push(...await Promise.all(singles.slice(i, i + concurrency).map(post)));
    report.concurrency.push({ concurrency, wallMs: performance.now() - started, requests });
  }
  report.finished = new Date().toISOString();
  await save();
  console.log(`Saved ${join(values.out, "results.json")}`);
} catch (error) {
  report.error = String(error.stack || error);
  await save();
  throw error;
}
