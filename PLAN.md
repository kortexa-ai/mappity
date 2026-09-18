# Plan

Exploratory project: something cool with OpenStreetMap, Mapillary, TypeSafe Jev and Cactus Needle.

## Done

- The engine: one sentence in, a probability per place out, streamed to the map as it is computed.
- Command bar: Needle extracts, Jev routes and verifies, code geocodes and measures.
- Street context from Mapillary detections, used only when Jev says the wish depends on the street.
- Coarse-to-fine judging (place types, then places) and selected reasons for the best matches.
- The guessing game, with Bayesian odds on the map.
- Web client: MapLibre GL on OpenFreeMap's dark style, no build step.

## Next, if this goes anywhere

- **Reverse game**: you think of a place, the map asks the questions. Pick each question by expected
  information gain over a question bank; Jev's answers for every candidate are already the likelihoods.
- **Walks by feel**: score street segments the way places are scored now, then route through the glow.
- **Open now**: needs an `opening_hours` parser in code. Jev must not compare times.
- **Photos**: Mapillary image ids come from the vector tiles (`/images?bbox=` fails in dense areas).
- A reviewed threshold for `STREET_MATTERS` and `KIND_FLOOR`; both were set by eye on a few wishes.

## Known rough edges

- A cold Overpass fetch takes 5 to 40 seconds. The client prefetches whenever the map settles, and the
  disk cache makes every later question instant, but the very first question in a new city can wait.
- Street context says "none seen" both for empty streets and for streets no one has photographed.
- English only. Jev's other languages are weaker, and Needle's tool descriptions are English.
