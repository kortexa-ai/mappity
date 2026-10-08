# Parallel Shingi client and latency comparison

Work order: https://github.com/kortexa-ai/mappity/issues/3
Engine: https://github.com/kortexa-ai/shingi-27b/issues/2
Production deployment: https://github.com/kortexa-ai/models.server/issues/50

Keep one place per Shingi request and admit at most four requests per batch loop.
Return results in input order, stop admitting work after a failure, and finish
already-started requests before reporting that failure. Keep the game's early
question-validity gate and the hosted provider's existing behavior.

Validate overlap, result mapping, failure handling and the actual HTTP game path.
After the new engine is deployed, compare unchanged serial and four-request clients
with frozen OSM inputs, identical questions and repeated application endpoint runs.
Keep full outputs in local report artifacts and publish the measured scope and limits.
