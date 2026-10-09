# Shingi throughput

Owner: https://github.com/kortexa-ai/mappity/issues/4

Measure whether eight concurrent callers improve throughput while retaining place isolation, ordering, and failure draining.

The updated engine reduced median search to 28.92 seconds and game latency to 4.48 seconds with four callers. Eight callers took 29.41 and 4.59 seconds. Retain four callers: full batches alone did not improve this workload. All 16 explicit-fact controls passed at one, four and eight callers. The experiment method, probability differences and shared-context results are in `experiments/README.md`; full artifacts are retained outside the source tree.
