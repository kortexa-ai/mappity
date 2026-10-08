# Shingi provider reliability and performance

Work order: https://github.com/kortexa-ai/mappity/issues/2

Fix optional-setting startup failures and inaccurate provider guidance. Measure
fixed workloads with cleaned place data, separate question validity from place
fit, and keep complete inputs and results. Preserve the hosted Jev path.

Sequence:

1. Repair startup and cover existing `.env` files under Bash and Zsh.
2. Compare Shingi batch sizes with fixed places/questions, repeated timings,
   explicit fixture labels and model/version metadata. Inspect prefix reuse and
   current serialization separately from potential shared-weight concurrency.
3. Adopt application changes only after the quality and timing checks support
   them. Validate search and game behavior, document the measured limits, and
   deliver through the owning issue.

The prior calibration candidate has no validated coverage of the game's
question-validity gate or the other judging roles. Keep production calibration
unchanged. The issue holds execution status and measurement evidence.
