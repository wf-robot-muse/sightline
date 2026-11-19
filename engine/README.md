# @sightline/engine

The SightLine recommendation engine. Platform-independent TypeScript: no UI, no Tauri, no vendor SDKs. Written once; the desktop shell (and any future shell) consumes it unchanged.

Phase 1 status (Nov 18, 2026): built and tested.

1. Canonical data model + provenance types — `src/model.ts`, `src/validate.ts`, `src/priority.ts` (per-metric source priority; Garmin is the step source of record).
2. Adapters — `src/adapters/`: manual entry (parity path), Garmin Personal API day bundles, Teladoc PDF extraction (BP logs + most-recent weight; the PDF's weight series is chart-only), Cronometer CSV (import-only; provisional header contract until a real export is parsed — that Phase 0 test is on hold).
3. Readiness engine — `src/readiness.ts` (personal baselines, green/yellow/red tiers, ACWR cap at yellow, per-pattern splits for injuries, confidence + missing-input reporting).
4. Weighted-goal engine — `src/goals.ts` (weight normalization, candidate scoring, open conflict resolution — fat loss + muscle = recomp — pace tracking inside hard safety bounds).
5. Weekly planner/replanner — `src/planner.ts` (regenerates the week from readiness, fasting windows, and injury gating, with spacing rules and ACSM benchmark reporting; every session carries its reasons).
6. Nutrition targets — `src/nutrition.ts` (MacroFactor-style expenditure estimate from intake + weight trend, protein-first ordering rule, low-carb remainder, tracked micronutrients, fasting-day electrolyte mode).
7. Coaching format — `src/coaching.ts` (observation / benchmark / labeled opinion only; a guard rejects motivational copy).

Tests: `npm test` (Node's built-in runner, no dependencies). Fixtures are synthetic — real user health data never enters this repo. The Phase 1 backtest against real Nov 2026 data runs locally outside the repo; its findings are recorded in the project notes and in code comments where they changed a rule.
