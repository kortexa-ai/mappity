// Twenty questions with a neighbourhood. The map picks a secret place; you ask yes/no questions in
// plain words. Jev answers the question for EVERY place at once, so one question does two jobs:
// the secret place's answer is what you hear, and everyone's answers update the odds on the map.
// Jev's nouls are calibrated probabilities, so they can be used as likelihoods directly.

import { randomUUID } from "node:crypto";
import * as jev from "./jev.js";
import { nearest, placesIn } from "./osm.js";
import { bboxAround } from "./geo.js";

const games = new Map();
const CANDIDATES = 60;
const BATCH = 60;

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

  const batches = [];
  for (let i = 0; i < game.places.length; i += BATCH) batches.push(game.places.slice(i, i + BATCH));
  const results = await Promise.all(
    batches.map((batch, b) =>
      jev.ask(
        // Keyed, not an array: Jev miscounts long arrays (measured in pipeline.js).
        { question, places: Object.fromEntries(batch.map((p, i) => [`place_${i}`, { name: p.name, ...p.tags }])) },
        {
          ...Object.fromEntries(
            batch.map((_, i) => [
              `p${i}`,
              jev.noul(
                `Someone asks \`question\` about \`places.place_${i}\`. Is the honest answer yes?`,
                "Yes, judging by what kind of place it is and what is known about it",
                "No, or very unlikely",
              ),
            ]),
          ),
          // Speculative: asked once, alongside the first batch, and costs no extra time.
          ...(b === 0 ? { askable: jev.noul("Is `question` a yes/no question that a person could ask about a place?") } : {}),
        },
      ),
    ),
  );

  const tokens = results.reduce((sum, r) => sum + r.tokens, 0);
  const usd = results.reduce((sum, r) => sum + r.usd, 0);
  const usage = { ms: performance.now() - started, tokens, usd, requests: results.length, judgments: game.places.length + 1 };
  if (results[0].answers.askable.noul < 0.4) return { askable: false, ...usage };

  const answers = results.flatMap((r, b) => batches[b].map((_, i) => r.answers[`p${i}`].noul));
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
