# Bounded VRAM cache

Owner: https://github.com/kortexa-ai/mappity/issues/5

Freeze actual search/game inputs and retain four-caller and eight-caller comparisons where the engine changes. Compare cache modes/budgets and GPU types using identical place isolation. Record request counts, score drift, normalized game odds, validity and explicit-fact controls. Adopt only measured improvements.

Develop Shingi on a local branch. Validate CPU tests and frozen GPU controls, then publish one consolidated runtime improvement on public main. Keep intermediate branches local. Store full reports under `~/Desktop/ai reports/shingi-vram-cache-2026-10-08/`.
