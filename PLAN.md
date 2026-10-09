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
  contract, locally on one RTX 4090. Place judgments use isolated place contexts and
  up to four concurrent requests; the game checks question validity before judging places. Hosted
  Jev retains its parallel batches.

## Next, if this goes anywhere

- **Reverse game**: you think of a place, the map asks the questions. Pick each question by expected
  information gain over a question bank; the judge's answers for every candidate are already the
  likelihoods.
- **Walks by feel**: score street segments the way places are scored now, then route through the glow.
- **Open now**: needs an `opening_hours` parser in code. The judge must not compare times.
- **Photos**: Mapillary image ids come from the vector tiles (`/images?bbox=` fails in dense areas).
- Validate `STREET_MATTERS`, `KIND_FLOOR`, explanation confidence and the game's separate
  question-validity gate on their own labeled examples. The current Shingi identity calibration
  has no mappity-specific validation. A place-fit calibration cannot establish the quality of
  these other roles; do not transfer the exploratory place-type bias to them.

## Known rough edges

- A cold Overpass fetch takes 5 to 40 seconds. The client prefetches whenever the map settles, and the
  disk cache makes every later question instant, but the very first question in a new city can wait.
- Street context says "none seen" both for empty streets and for streets no one has photographed.
- English only. The judging model's other languages are weaker, and Needle's tool descriptions are
  English.
- Shingi serves four sequences with shared weights. Prefix snapshots for later requests
  still cross host RAM; a shared prefix stays on the GPU within a question exchange.
  Larger shared place contexts can change answers as well as latency. Eight concurrent
  client requests filled batches better but were slightly slower than four in the full
  application. See `experiments/README.md` for the measurements and limitations.
