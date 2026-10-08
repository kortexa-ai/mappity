// The judging model behind mappity: state + typed questions in, probabilities out. It never writes
// text. Two providers answer the same /v1/systemone contract, chosen by JEV_PROVIDER in .env:
//
//   jev     hosted TypeSafe Jev (jev-latest) via the official SDK. Needs TYPESAFE_API_KEY.
//   shingi  self-hosted Shingi 27B, served locally on the smarty RTX 4090.
//           POSTs {model, state, questions} to SHINGI_URL/v1/systemone, no key.
//
// Both providers return the same answer shapes (`{type:"noul",noul}` / `{type:"choice",choice,
// confidence,probabilities}`); pipeline.js and game.js choose batching for the provider.
// Shingi's deployed calibration is reported by /v1/version. The current identity
// calibration has not been validated for mappity's different question roles.

import { TypeSafeClient } from "@typesafe-ai/sdk";

const PROVIDER = (process.env.JEV_PROVIDER || "jev").trim().toLowerCase();
export const provider = PROVIDER;

// What a token costs, per provider: the hosted Jev bills $0.042 per million input tokens
// (output free); the local Shingi is flat-rate electricity, so its bill is always $0.00 —
// `usd` is kept a number, never undefined, because the client's bill line formats it with toFixed.
const RATE = { jev: 0.042 / 1e6, shingi: 0 };

/** @returns {{ask: (state: object, questions: object) => Promise<object>, noul: Function, choice: Function}} */
function makeClient() {
  if (PROVIDER === "shingi") return shingiClient();
  if (PROVIDER !== "jev") throw new Error(`JEV_PROVIDER must be "jev" or "shingi", got "${PROVIDER}"`);
  // Reads TYPESAFE_API_KEY from the environment. The SDK retries 429/529 with backoff.
  return sdkClient();
}

function sdkClient() {
  const client = new TypeSafeClient();
  return {
    async ask(state, questions) {
      const started = performance.now();
      const result = await client.systemOne({ state, questions });
      return usage(started, result, RATE.jev);
    },
    noul: (instructions, yes, no) => ({ type: "noul", instructions, ...(yes && no ? { criteria: { true: yes, false: no } } : {}) }),
    choice: (instructions, criteria) => ({ type: "choice", instructions, criteria }),
  };
}

function shingiClient() {
  const base = (process.env.SHINGI_URL || "http://192.168.2.3:2068").replace(/\/+$/, "");
  const model = (process.env.SHINGI_MODEL || "shingi-27b").trim();
  const url = `${base}/v1/systemone`;
  return {
    // A timed-out request can still be running. Bound the client wait without
    // automatic retries that could submit the same inference twice.
    async ask(state, questions) {
      const started = performance.now();
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, state, questions }),
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`shingi ${response.status} ${await response.text().catch(() => "")}`.slice(0, 300));
      const result = await response.json();
      return usage(started, result, RATE.shingi);
    },
    // Same wire primitives as the SDK (instructions + criteria map; null descriptions allowed).
    noul: (instructions, yes, no) => ({ type: "noul", instructions, ...(yes && no ? { criteria: { true: yes, false: no } } : {}) }),
    choice: (instructions, criteria) => ({ type: "choice", instructions, criteria }),
  };
}

/** Ask the judging model a map of questions about one state. Returns answers plus what it cost. */
function usage(started, result, rate) {
  const tokens = result.usage.input_tokens;
  return {
    answers: result.answers,
    model: result.model,
    ms: performance.now() - started,
    tokens,
    usd: tokens * rate,
  };
}

const client = makeClient();

export const ask = (state, questions) => client.ask(state, questions);
export const noul = (instructions, yes, no) => client.noul(instructions, yes, no);
export const choice = (instructions, criteria) => client.choice(instructions, criteria);
