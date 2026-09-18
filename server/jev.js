// TypeSafe Jev: state + typed questions in, probabilities out. It never writes text.
// Docs: https://docs.typesafe.ai/llms.txt

import { TypeSafeClient } from "@typesafe-ai/sdk";

// Reads TYPESAFE_API_KEY from the environment. The SDK retries 429/529 with backoff.
const client = new TypeSafeClient();

const USD_PER_TOKEN = 0.042 / 1e6; // jev-1.13: input tokens only, output is free

/** Ask Jev a map of questions about one state. Returns answers plus what it cost. */
export async function ask(state, questions) {
  const started = performance.now();
  const result = await client.systemOne({ state, questions });
  const tokens = result.usage.input_tokens;
  return {
    answers: result.answers,
    model: result.model,
    ms: performance.now() - started,
    tokens,
    usd: tokens * USD_PER_TOKEN,
  };
}

export const noul = (instructions, yes, no) => ({
  type: "noul",
  instructions,
  ...(yes && no ? { criteria: { true: yes, false: no } } : {}),
});

export const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
