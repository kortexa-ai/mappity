# Plan

Exploratory project: something cool with OpenStreetMap, Mapillary, a judging model (hosted TypeSafe
Jev, or self-hosted Shingi 27B via `JEV_PROVIDER` in `.env`) and Cactus Needle.

## Done

- The engine: one sentence in, a probability per place out, streamed to the map as it is computed.
- Command bar: Needle extracts, Jev routes and verifies, code geocodes and measures.
- Street context from Mapillary detections, used only when Jev says the wish depends on the street.
- Coarse-to-fine judging (place types, then places) and selected reasons for the best matches.
- The guessing game, with Bayesian odds on the map.
- Web client: MapLibre GL on OpenFreeMap's dark style, no build step.
- Provider switch: `JEV_PROVIDER=jev|shingi` in `.env`; Shingi answers the same `/v1/systemone`
  contract, locally on one RTX 4090, with raw (uncalibrated) probabilities.

## Next, if this goes anywhere

- **Reverse game**: you think of a place, the map asks the questions. Pick each question by expected
  information gain over a question bank; the judge's answers for every candidate are already the
  likelihoods.
- **Walks by feel**: score street segments the way places are scored now, then route through the glow.
- **Open now**: needs an `opening_hours` parser in code. The judge must not compare times.
- **Photos**: Mapillary image ids come from the vector tiles (`/images?bbox=` fails in dense areas).
- A reviewed threshold for `STREET_MATTERS` and `KIND_FLOOR`; both were set by eye on a few wishes,
  against Jev's calibrated probabilities. Shingi's scores compress toward the ends (a cold-cache
  "hot drink" wish put seven cafes in the 0.95-0.97 band), and `explain()` filters on its own
  reported confidence, which is uncalibrated on Shingi — re-check both before trusting a Shingi answer.

## Known rough edges

- A cold Overpass fetch takes 5 to 40 seconds. The client prefetches whenever the map settles, and the
  disk cache makes every later question instant, but the very first question in a new city can wait.
- Street context says "none seen" both for empty streets and for streets no one has photographed.
- English only. The judging model's other languages are weaker, and Needle's tool descriptions are
  English.
- Shingi's one GPU worker answers the questions of a request one by one, and the server's parallel
  batches queue behind each other: a full search takes minutes, not the ~1 second that the batching
  was tuned for. Fine for a hobbyist without a Jev key; not a demo path.
