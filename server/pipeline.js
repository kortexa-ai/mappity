// One sentence in, a glowing map out. Code owns the workflow; the models only make small judgments.
//
//   Needle  pulls out what code can act on:  go_to("Ballard"), search_near("aquarium", 5 min)
//   Jev     decides what kind of request it is, and checks that Needle's places are really places
//   code    geocodes, measures walking distance, fetches OSM places and Mapillary street detections
//   Jev     judges place types first (coarse), then every surviving place (fine), in parallel batches
//   Jev     picks, for the best matches, the one fact that explains the match (select, never generate)

import * as jev from "./jev.js";
import * as needle from "./needle.js";
import { geocode, nearest, placesIn } from "./osm.js";
import { streetContext } from "./mapillary.js";
import { bboxAround, haversine, walkRadius } from "./geo.js";

const MAX_RADIUS_M = 1500;
const MAX_SHOWN = 1500; // places drawn on the map
const MAX_JUDGED = 300; // places that get their own judgment
const BATCH = 50; // places per Jev request; every question in a request runs in parallel
const KIND_FLOOR = 0.1; // a place type below this cannot satisfy the wish: skip its places
const EXPLAIN_TOP = 6;
const STREET_MATTERS = 0.65; // how sure Jev must be that the wish is about the street before we read Mapillary

const pretty = (kind) => kind.replaceAll("_", " ");

/** Step 1: what is being asked? Needle extracts, then one Jev request routes and verifies. */
async function understand(text, emit) {
  const extraction = await needle.extract(text);
  emit({ step: "needle", ...extraction });

  // Every string Needle pulled out that should be a location.
  const claims = extraction.calls.flatMap((call) =>
    [call.arguments?.place, call.arguments?.landmark].filter((v) => typeof v === "string" && v.trim()),
  );

  const questions = {
    kind: jev.choice("A person typed `input` into a map app. What kind of request is it?", {
      map_command:
        "Only an instruction to move or zoom the map, such as going to a named location. It describes nothing the person wants to find or do.",
      wish: "It describes something the person wants, needs or feels, which places on the map could satisfy. It may also mention a location.",
      play_game: "The person wants to play a game, such as a guessing game.",
      off_topic: "It has nothing to do with places, maps or games.",
    }),
    street: jev.noul(
      "Does what the person wants in `input` depend on what the street or outdoor surroundings are like, such as lighting at night, feeling safe, benches, crossings, security cameras, or how busy the street is?",
    ),
  };
  claims.forEach((claim, n) => {
    questions[`claim${n}`] = jev.noul(
      `In \`input\`, is "${claim}" used as the name of a geographic location, landmark or area that could be found on a map?`,
      "It names a location, landmark, neighborhood or area the person is referring to as a place",
      "It is a thing, product, food, feeling or vague word, not a location",
    );
  });

  const routed = await jev.ask({ input: text }, questions);
  const verified = claims.map((value, n) => ({ value, p: routed.answers[`claim${n}`].noul }));
  emit({
    step: "route",
    ms: routed.ms,
    tokens: routed.tokens,
    usd: routed.usd,
    kind: routed.answers.kind.choice,
    confidence: routed.answers.kind.confidence,
    street: routed.answers.street.noul,
    verified: verified.map((v) => ({ ...v, ok: v.p >= 0.5 })),
  });

  const trusted = new Set(verified.filter((v) => v.p >= 0.5).map((v) => v.value));
  const calls = extraction.calls.filter((call) => {
    const claim = call.arguments?.place ?? call.arguments?.landmark;
    return claim === undefined || trusted.has(claim);
  });
  return { kind: routed.answers.kind.choice, street: routed.answers.street.noul >= STREET_MATTERS, calls, rejected: verified.filter((v) => v.p < 0.5), usage: routed };
}

/** Step 2: where? A verified location wins; otherwise search what the person is looking at. */
async function searchArea(calls, view, emit) {
  const located = calls.find((c) => c.name === "search_near") ?? calls.find((c) => c.name === "go_to");
  if (!located) {
    const [w, s, e, n] = view.bbox;
    const across = Math.min(haversine([w, s], [e, s]), haversine([w, s], [w, n]));
    return { center: view.center, radiusM: Math.max(250, Math.min(across / 2, MAX_RADIUS_M)), fly: false };
  }

  const query = located.arguments.landmark ?? located.arguments.place;
  const started = performance.now();
  const hit = await geocode(query, view.bbox);
  emit({ step: "geocode", ms: performance.now() - started, query, name: hit?.name, cached: hit?.cached, found: Boolean(hit) });
  if (!hit) return null;

  const minutes = located.arguments.max_walk_minutes;
  // A neighbourhood is as big as its own outline; a landmark gets a comfortable stroll around it.
  const [w, s, e, n] = hit.bbox;
  const outline = Math.max(haversine([w, s], [e, s]), haversine([w, s], [w, n])) / 2;
  const radiusM = minutes ? walkRadius(minutes) : Math.max(500, outline);
  return { center: [hit.lng, hit.lat], radiusM: Math.min(radiusM, MAX_RADIUS_M), walkMinutes: minutes, name: hit.name, fly: true };
}

/** Coarse pass: which place types could satisfy the wish at all? One request, one question per type. */
async function judgeKinds(wish, places, emit) {
  const kinds = [...new Set(places.map((p) => p.kind))];
  // The type is written into the question itself. Measured: asking about `place_types[37]` makes Jev
  // count, and it miscounts ("I need cash" ranked gift shops over ATMs). No lookup, no miscount.
  const asked = await jev.ask(
    { wish },
    Object.fromEntries(
      kinds.map((kind, i) => [
        `k${i}`,
        jev.noul(
          `Could a place of the type "${pretty(kind)}" be a good place to go for someone whose wish is \`wish\`?`,
          "Yes: places of this type can offer what the wish asks for",
          "No: places of this type do not offer what the wish asks for",
        ),
      ]),
    ),
  );
  const byKind = new Map(kinds.map((kind, i) => [kind, asked.answers[`k${i}`].noul]));
  emit({
    step: "kinds",
    ms: asked.ms,
    tokens: asked.tokens,
    usd: asked.usd,
    kinds: kinds.map((kind) => ({ kind, p: byKind.get(kind), count: places.filter((p) => p.kind === kind).length })).sort((a, b) => b.p - a.p),
  });
  return { byKind, usage: asked };
}

/**
 * Fine pass: every surviving place answers the wish with a probability.
 *
 * When the wish is about the street, one vague question ("is this a good place?") goes flat: every
 * place scored about 0.8. So the judgment is split in two, the place itself and the street outside,
 * and code combines them. Each half is narrow enough to answer well, and the result can be explained.
 */
async function judgePlaces(wish, places, contexts, emit) {
  const batches = [];
  for (let i = 0; i < places.length; i += BATCH) batches.push(places.slice(i, i + BATCH));

  return Promise.all(
    batches.map(async (batch) => {
      const state = {
        wish,
        // Keyed, not an array. Measured on 240 places: `places[i]` is 100% right at 15 per request,
        // 95% at 30 and 75% at 60, because Jev has to count to the index. `places.place_i` stays at 99%+.
        places: Object.fromEntries(
          batch.map((p, i) => [`place_${i}`, { name: p.name, ...p.tags, ...(contexts ? { street_view: contexts.get(p.id) } : {}) }]),
        ),
      };
      const questions = {};
      batch.forEach((_, i) => {
        if (!contexts) {
          questions[`p${i}`] = jev.noul(
            `Would \`places.place_${i}\` be a good place to go for someone whose wish is \`wish\`? Ignore any part of the wish about location, distance or walking time: that is already handled.`,
            "The place plausibly satisfies the wish",
            "The place does not offer what the wish asks for",
          );
          return;
        }
        questions[`fit${i}`] = jev.noul(
          `Leave the street outside aside. Is \`places.place_${i}\` itself the kind of place that suits someone whose wish is \`wish\`?`,
          "The place itself, by its type and details, suits the wish",
          "The place itself does not suit the wish",
        );
        questions[`street${i}`] = jev.noul(
          `\`places.place_${i}.street_view\` lists what street-level photos show within 50 metres. Does that street suit someone whose wish is \`wish\`?`,
          "The street surroundings clearly help with the wish",
          "The street surroundings do not help, or work against the wish",
        );
      });

      const asked = await jev.ask(state, questions);
      const scores = batch.map((p, i) => {
        if (!contexts) return [p.id, asked.answers[`p${i}`].noul];
        const fit = asked.answers[`fit${i}`].noul;
        const street = asked.answers[`street${i}`].noul;
        return [p.id, Math.sqrt(fit * street), { fit, street }]; // geometric mean: both halves have to hold
      });
      emit({ step: "judge", ms: asked.ms, tokens: asked.tokens, usd: asked.usd, scores, questions: Object.keys(questions).length });
      return { scores, usage: asked, questions: Object.keys(questions).length };
    }),
  );
}

/** Jev cannot write a reason, but it can select one: which known fact best explains the match? */
async function explain(wish, top, contexts, emit) {
  const facts = top.map((p) => {
    const entries = Object.entries(p.tags).map(([k, v]) => `${pretty(k)}: ${pretty(v)}`);
    const street = contexts ? Object.entries(contexts.get(p.id)).filter(([, v]) => v === "lots").map(([k]) => `lots of ${k} nearby`) : [];
    return [...entries, ...street].slice(0, 14);
  });
  const asked = await jev.ask(
    { wish, places: Object.fromEntries(top.map((p, i) => [`place_${i}`, { name: p.name, facts: facts[i] }])) },
    Object.fromEntries(
      top.map((_, i) => [
        `why${i}`,
        jev.choice(`Which single fact about \`places.place_${i}\` is the strongest reason it would suit someone whose wish is \`wish\`?`, {
          ...Object.fromEntries(facts[i].map((fact) => [fact, null])),
          "its name": "Only the name of the place suggests it fits",
        }),
      ]),
    ),
  );
  emit({
    step: "explain",
    ms: asked.ms,
    tokens: asked.tokens,
    usd: asked.usd,
    reasons: top
      .map((p, i) => ({ id: p.id, fact: asked.answers[`why${i}`].choice, confidence: asked.answers[`why${i}`].confidence }))
      .filter((reason) => reason.confidence >= 0.5 && reason.fact !== "its name"),
  });
  return asked;
}

/** Run one request from the command bar. `emit` receives each step as it completes. */
export async function run({ text, view }, emit) {
  const started = performance.now();
  const spent = { tokens: 0, usd: 0, requests: 0, judgments: 0 };
  const bill = (usage, judgments) => {
    spent.tokens += usage.tokens;
    spent.usd += usage.usd;
    spent.requests += 1;
    spent.judgments += judgments;
  };
  const done = (outcome) => emit({ step: "done", outcome, ms: performance.now() - started, ...spent });

  const understood = await understand(text, emit);
  bill(understood.usage, 2 + understood.rejected.length + understood.calls.length);

  const zoom = understood.calls.find((c) => c.name === "zoom");
  if (zoom) emit({ step: "command", name: "zoom", direction: zoom.arguments.direction });

  if (understood.kind === "play_game") return (emit({ step: "game" }), done("game"));
  if (understood.kind === "off_topic" && !understood.calls.length) return (emit({ step: "refuse", reason: "off_topic" }), done("refused"));

  const area = await searchArea(understood.calls, view, emit);
  if (!area) return (emit({ step: "refuse", reason: "unknown_place" }), done("refused"));
  const isWish = understood.kind === "wish";
  emit({ step: "area", ...area, search: isWish });
  if (!isWish) return done(zoom || area.fly ? "moved" : "nothing");

  // Places from OpenStreetMap.
  const bbox = bboxAround(area.center, area.radiusM);
  const fetchStarted = performance.now();
  const fetched = await placesIn(bbox);
  const places = nearest(fetched.value, area.center, area.radiusM, MAX_SHOWN);
  emit({
    step: "places",
    ms: performance.now() - fetchStarted,
    cached: fetched.cached,
    count: places.length,
    places: places.map(({ id, name, kind, lng, lat, tags, metres }) => ({ id, name, kind: pretty(kind), lng, lat, tags, metres })),
  });
  if (!places.length) return done("empty");

  // The street, when the wish is about the street.
  let contexts = null;
  const streetReady = understood.street
    ? streetContext(places, bbox)
        .then((street) => {
          contexts = new Map(places.map((p, i) => [p.id, street.contexts[i]]));
          emit({ step: "street", ms: street.ms, detections: street.detections, points: street.points, contexts: Object.fromEntries(contexts) });
        })
        .catch((error) => emit({ step: "street", error: String(error.message || error) }))
    : null;

  // Coarse, then fine.
  const [coarse] = await Promise.all([judgeKinds(text, places, emit), streetReady]);
  bill(coarse.usage, coarse.byKind.size);
  // Best place types first, nearest first within a type (places arrive sorted by distance).
  const survivors = places
    .filter((p) => coarse.byKind.get(p.kind) >= KIND_FLOOR)
    .sort((a, b) => coarse.byKind.get(b.kind) - coarse.byKind.get(a.kind))
    .slice(0, MAX_JUDGED);
  emit({ step: "shortlist", judged: survivors.length, skipped: places.length - survivors.length });

  const judged = await judgePlaces(text, survivors, contexts, emit);
  for (const batch of judged) bill(batch.usage, batch.questions);

  const byId = new Map(survivors.map((p) => [p.id, p]));
  const top = judged
    .flatMap((b) => b.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, EXPLAIN_TOP)
    .filter(([, p]) => p >= 0.35)
    .map(([id]) => byId.get(id));
  if (top.length) bill(await explain(text, top, contexts, emit), top.length);

  done("searched");
}

/** Warm the caches for what the person is looking at, so that the first question is fast. */
export async function prefetch(view) {
  const [w, s, e, n] = view.bbox;
  const across = Math.min(haversine([w, s], [e, s]), haversine([w, s], [w, n]));
  if (across > 2 * MAX_RADIUS_M * 1.5) return { skipped: "zoomed out too far" };
  const fetched = await placesIn(bboxAround(view.center, Math.max(250, Math.min(across / 2, MAX_RADIUS_M))));
  return { places: fetched.value.length, cached: fetched.cached };
}
