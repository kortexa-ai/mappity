// Twenty questions with a neighbourhood. The map picks a secret place; you ask yes/no questions in
// plain words. The judge answers for EVERY place, so one question does two jobs:
// the secret place's answer is what you hear, and everyone's answers update the odds on the map.
// These probabilities supply heuristic likelihoods; their calibration affects the game's odds.

import { randomUUID } from "node:crypto";
import * as jev from "./jev.js";
import { gameRequest, askableQuestion, mapBatches } from "./judge-batches.js";
import { nearest, placesIn } from "./osm.js";
import { bboxAround } from "./geo.js";

const games = new Map();
const CANDIDATES = 60;
const BATCH = jev.provider === "shingi" ? 1 : 60;

const pretty = (kind) => kind.replaceAll("_", " ");

export async function start({ center, radiusM }) {
  const radius = Math.min(radiusM, 1000);
  const fetched = await placesIn(bboxAround(center, radius));
  // Only named places with a few facts on record: the secret has to be answerable and guessable.
  const rich = fetched.value.filter((p) => Object.keys(p.tags).length >= 3 && !/^(Public toilets|Viewpoint|Playground)$/.test(p.name));
  const places = nearest(rich, center, radius, CANDIDATES);
  if (places.length < 8) throw new Error("Not enough places here for a game. Zoom in on a busier area.");

  const id = randomUUID();
  const secret = places[Math.floor(Math.random() * places.length)];
  games.set(id, { places, secret, odds: places.map(() => 1 / places.length), asked: 0 });
  // Frame the candidates, not the area we searched: sixty places downtown fit in two blocks.
  const reach = Math.max(120, places.at(-1).metres * 1.2);
  return { id, center, radiusM: reach, places: places.map(({ id, name, kind, lng, lat }) => ({ id, name, kind: pretty(kind), lng, lat })) };
}

const verdictFor = (p) =>
  p >= 0.8 ? "Yes." : p >= 0.6 ? "Probably." : p > 0.4 ? "Hard to say." : p > 0.2 ? "Probably not." : "No.";

export async function ask(id, question) {
  const game = games.get(id);
  if (!game) throw new Error("That game is over. Start a new one.");
  const started = performance.now();

  // A local worker must not judge every candidate before rejecting an invalid question.
  // Hosted Jev can keep the speculative question in its first parallel batch.
  const local = jev.provider === "shingi";
  const gate = local ? await jev.ask({ question }, { askable: askableQuestion() }) : null;
  if (gate && gate.answers.askable.noul < 0.4) return {
    askable: false, ms: performance.now() - started, tokens: gate.tokens, usd: gate.usd,
    requests: 1, judgments: 1,
  };
  const results = await mapBatches(game.places, BATCH, async (batch, b) => {
    // Keyed, not an array: Jev miscounts long arrays (measured in pipeline.js).
    const { state, questions } = gameRequest(question, batch, !local && b === 0);
    return jev.ask(state, questions);
  }, local ? 8 : Infinity);

  const billed = gate ? [gate, ...results] : results;
  const tokens = billed.reduce((sum, r) => sum + r.tokens, 0);
  const usd = billed.reduce((sum, r) => sum + r.usd, 0);
  const usage = { ms: performance.now() - started, tokens, usd, requests: billed.length, judgments: game.places.length + 1 };
  if (!gate && results[0].answers.askable.noul < 0.4) return { askable: false, ...usage };

  const answers = results.flatMap((r, b) => game.places.slice(b * BATCH, (b + 1) * BATCH).map((_, i) => r.answers[`p${i}`].noul));
  const truth = answers[game.places.indexOf(game.secret)];

  // Bayes: P(place | answer) is proportional to P(answer | place) x P(place). A murky answer updates nothing.
  if (truth >= 0.6 || truth <= 0.4) {
    const heardYes = truth >= 0.6;
    const next = game.odds.map((prior, i) => prior * (0.08 + 0.84 * (heardYes ? answers[i] : 1 - answers[i])));
    const total = next.reduce((a, b) => a + b, 0);
    game.odds = next.map((v) => v / total);
  }
  game.asked += 1;

  return { askable: true, verdict: verdictFor(truth), asked: game.asked, odds: game.places.map((p, i) => [p.id, game.odds[i]]), ...usage };
}

export function guess(id, placeId) {
  const game = games.get(id);
  if (!game) throw new Error("That game is over. Start a new one.");
  const correct = game.secret.id === placeId;
  if (correct) {
    games.delete(id);
    return { correct, asked: game.asked, secret: reveal(game) };
  }
  // A wrong guess is evidence too: that place is out.
  const wrong = game.places.findIndex((p) => p.id === placeId);
  if (wrong >= 0) {
    game.odds[wrong] = 0;
    const total = game.odds.reduce((a, b) => a + b, 0);
    game.odds = game.odds.map((v) => v / total);
  }
  return { correct, asked: game.asked };
}

export function giveUp(id) {
  const game = games.get(id);
  if (!game) throw new Error("That game is over. Start a new one.");
  games.delete(id);
  return { secret: reveal(game), asked: game.asked };
}

const reveal = (game) => ({ id: game.secret.id, name: game.secret.name, kind: pretty(game.secret.kind), lng: game.secret.lng, lat: game.secret.lat });
