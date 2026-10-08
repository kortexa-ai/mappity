# Shingi performance checks

Run against an existing Shingi service; this script does not load models, restart services or fit
calibration. It saves complete request bodies, answers, per-request timing, model/version metadata,
the fixture and its SHA-256, and results after each completed configuration.

```sh
JEV_PROVIDER=shingi node experiments/shingi-performance.mjs --out .cache/shingi-performance
# Optional diagnostic subsets:
JEV_PROVIDER=shingi node experiments/shingi-performance.mjs --out .cache/shingi-quality \
  --workloads quality --sizes 1,2,5,10,25,50 --rounds 2
```

`SHINGI_URL` and `SHINGI_MODEL` select the target. Add `--env-file=.env` to the Node command to read
the project's settings. Inspect `/v1/version` and the actual device before comparing different
servers; identical port numbers on different hosts do not identify the same model.

## Workloads and method

- **Search:** 50 frozen places from mappity's cleaned OSM cache, one fixed wish and the same
  fine-pass question/criteria as the app. Total places and questions stay fixed at every batch size.
  There are no gold search labels; score changes measure context sensitivity, not accuracy.
- **Game:** the same 50 places, asking whether each is a cafe. Labels come from its explicit
  `amenity` tag. This tests a narrow fact, not general game quality.
- **Explicit-fact controls:** four fact patterns under four location names (16 cases), explicitly stating whether
  indoor tables and hot coffee are available. This includes takeaway-only coffee windows and
  places that offer neither. Labels refer to the stated facts, not assumptions about real venues.
- **Question validity:** a separate set of valid yes/no questions and invalid open-ended requests.
  This checks the actual game's `askable` question and its 0.4 threshold, not place-fit scores.
- **Concurrency:** the same eight distinct short requests, serial versus four simultaneous clients,
  in both orders. Per-request wall time includes queue wait.

The model is warmed once. The two default sweeps reverse the order of batch sizes. HTTP requests
are serial except in the explicit concurrency check. A configuration changes how many places are
visible together, so its outputs need not equal those of another configuration. A fixed query count
alone does not guarantee equal semantics. These are diagnostics, not a representative calibration
corpus or evidence of general accuracy. The data retain OpenStreetMap attribution and ODbL terms.

## Parallel production engine and client, 2026-10-08

Production Shingi now uses [engine `b2e1393`](https://github.com/kortexa-ai/shingi-27b/commit/b2e1393322bab9e459ca3df6a5e744a3a5748a0d),
deployed through models.server `b2f7723` on the RTX 4090. Weights, identity calibration
and Prism runtime are unchanged. Mappity keeps one place per request and admits four
requests at a time. Results retain their input order. A failed request stops new work;
already-started requests finish before the error is returned. Invalid game questions
still stop at the separate validity gate.

The comparison used actual local `/api/ask`, `/api/game/start` and `/api/game/ask`
endpoints against production Shingi. The serial client was Mappity `67eb987`.
Six runs used the order serial, parallel, parallel, serial, serial, parallel. Each
isolated application used the same frozen OSM tile values, with cache timestamps
refreshed to prevent a network refresh. The wish and Pike Place viewport match the
October 7 run. Full application events, inputs, outputs and source hashes were retained.

| Workload | Serial client: median (range), 3 runs | Four-request client: median (range), 3 runs |
|---|---:|---:|
| Search: 693 places, 425 judgments | 41.87 s (41.47–42.44) | 33.90 s (33.87–34.12) |
| Game: 60 candidates plus validity gate | 7.09 s (7.07–7.25) | 5.49 s (5.46–5.53) |
| Invalid game question: rejected by the gate | 0.098 s (0.093–0.101) | 0.103 s (0.102–0.105) |

Search used 19.0% less time; the valid game question used 22.5% less time. Every search
made the same 303 model requests and counted 66,717 logical input tokens. All 300
fine-pass place IDs matched. The coarse pass still took about 5.3 seconds. The earlier
40.73-second Shingi search is one observation on the previous engine, not a fresh
paired baseline for this table.

The serial scores were identical across runs. Parallel batching changed search
probabilities by a mean absolute 0.00192–0.00249, with a maximum change of 0.01758.
Two near-0.5 scores crossed that threshold in two of the three parallel runs; the
top ten retained nine of the serial top ten in every parallel run. Search has no
gold labels, so this does not establish equivalent ranking quality or calibration.
All 16 explicit-fact controls passed with both one and four clients, and all game
odds were finite and normalized. The 22 application tests passed, including bounded
concurrency, result order, failure draining, the real HTTP game path and early rejection.

Frozen OSM cache SHA-256: `e7ba6c56dd0b1a3adc44c5d30194cad887f9dca105e1ace858a1fa48e5aebd86`.
Engine correctness and memory measurements are in the [Shingi report](https://github.com/kortexa-ai/shingi-27b/blob/main/results/parallel-decisions/REPORT.md).

## Measured on Smarty's RTX 4090, 2026-10-07

Shingi 27B v3.2 weights `c62ae5b6…`, identity calibration, Prism runtime `d8f26eec…`.
The two observations per size were close. Values below are their mean wall times.

| Places per request | Search: 50 places | Game: 50 places | Controls: errors out of 16 |
|---|---:|---:|---:|
| 1 | 5.5 s | 5.0 s | 0 |
| 2 | 5.1 s | 4.7 s | 0 |
| 5 | 6.4 s | 6.0 s | 2 |
| 10 | 9.9 s | 9.2 s | 5 |
| 25 | 15.6 s | 15.0 s | 6 |
| 50 | 18.2 s | 17.8 s | 6 |

All batch sizes answered the cafe-tag game check correctly. Search probabilities changed by as
much as 0.797 between individual and 50-place contexts. Mappity uses one place per Shingi request:
it removes unrelated places from each judgment, while pairs offered only a small speed gain in this
sample. The hosted Jev path keeps its original parallel batches. This choice does not establish a
universal optimal batch size for Shingi or change its calibration.

Eight short requests took 0.76–0.82 s serial and 0.79–0.80 s with four concurrent clients. The
then-deployed native worker serialized inference. These measurements do not answer how many
sequences could share model weights in a different serving implementation.

The old question-validity prompt accepted "Which of these places is the best?" (0.51). Adding
explicit yes/no versus open-ended criteria rejected that request and passed all 18 diagnostic
questions, including 12 additional cases. This is a prompt correction, not calibration validation.

### Full application endpoints

Compared the original `3972513` server and the revised server sequentially, using the same
Pike Place viewport, cached OSM data and wish: "somewhere to sit with a hot drink and watch the
rain". Both Shingi searches saw 693 places and made 425 judgments, including the 300-place fine
pass. These are single end-to-end observations, separate from the repeated fixed-workload sweeps.

| Endpoint/workload | Original Shingi | Revised Shingi | Revised Jev |
|---|---:|---:|---:|
| Search, warm OSM cache | 148.77 s | 40.73 s | 0.81 s |
| Game: "Is this place a cafe?" | 36.00 s | 6.71 s | 0.13 s |
| Game: "Which of these places is the best?" | 36.04 s, accepted incorrectly | 0.095 s, rejected | 0.16 s, rejected |

The Shingi search was 3.65 times faster, with the same number of judgments. Its fine pass now
streams individual results as they arrive. It still takes tens of seconds for 300 places on the
then-deployed serial worker; reducing each request's context did not create parallel inference.
Different context composition changes scores, so equal judgment counts do not prove equivalent
search quality. The Jev run verifies its retained hosted path, not a controlled model comparison.

## What prefix reuse does

Prefix reuse was already enabled in the original worker. It snapshots complete 512-token prefix
blocks, restores that sequence for each question, and evaluates the remaining prefix and question tokens.
A short prefix with no complete block has nothing to cache. Logical `usage.input_tokens` counts
each full prompt, including reused text; it is not executed-prefill work.

A separate native trace on the Pro 6000, using the installed binary and the same 50-place payload,
reused 2,048 of 2,129 prefix tokens with zero fallbacks. The 217.7 MiB snapshot was restored for each
question. The fresh request took 4.36 s, including about 0.57 s for the shared prefix and 1.11 s in
restores; a cached repeat took 3.81 s. These are cost components on the 6000, not 4090 timings.
The 10-place prefix was only 439 tokens and reused no complete block. This explains why HTTP
cold/warm comparisons alone cannot establish that prefix caching is broken or saves no work.

The 4090 had 3,592 MiB free beside its existing services. That rules out another full model copy
in the current footprint; it does not size shared-weight contexts. The preload and runtime
headroom floors are separate checks. A restart releases the old allocation first. No production
service was stopped for these measurements, and the temporary native profiler was closed.

The original exploratory place-type calibration is not deployed. It did not test routing, street
judgments or the actual validity gate, and its original model inputs were not fully preserved.
