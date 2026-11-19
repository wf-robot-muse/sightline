# @sightline/engine

The SightLine recommendation engine. Platform-independent TypeScript: no UI, no Tauri, no vendor SDKs. Written once; the desktop shell (and any future shell) consumes it unchanged.

Phase 1 builds, in order:

1. Canonical data model + provenance types.
2. Readiness engine (personal baselines, green/yellow/red tiers, per-pattern splits for injuries).
3. Weighted-goal engine (goal scoring, conflict resolution by weight, pace tracking inside safety bounds).
4. Replanner (regenerate the week on any change: missed session, check-in, fast, injury, goal edit).
5. Nutrition targets (adaptive energy, protein-first ordering rule, tracked micronutrients).

The engine ships with its own test suite, including a backtest harness that replays recorded historical data through the planner for review before any recommendation is shown live.
