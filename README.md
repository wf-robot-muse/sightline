# SightLine

SightLine is a personalized health and training app: it builds daily workout, activity, and nutrition recommendations from the user's own health data and goals, weighted by the priority the user sets, and replans on the fly as conditions change.

**Status:** Development framework scaffold (Phase 0). The design spec is approved (v1.0, 2026-11-18) and is the build reference. The spec itself is maintained outside this public repo.

## Layout

| Path | What it is |
|---|---|
| `src/` + `src-tauri/` | The Tauri 2 desktop app shell (TypeScript/Vite front end, Rust back end), from the Tauri foundation pattern. |
| `engine/` | The recommendation engine: platform-independent TypeScript with no UI or platform dependencies and its own test suite. Goal scoring, readiness, replanning, and injury gating live here and are written once; shells change, the engine does not. |

## Identifiers

| Item | Value |
|---|---|
| App identifier | `com.wf.robot.muse.sightline` |
| Product name | `SightLine` |
| Window | 800 × 600, title `SightLine` |

## Principles (from the approved spec)

- **Source-resilient data layer.** The engine talks to a canonical data model, never to a vendor. Every data source is a replaceable adapter, and every metric has a manual-entry path — the engine runs end-to-end on manual-only data.
- **Runtime data, never hardcoded.** Goals, deadlines, priority weights, equipment lists, and routines are user data entered and changed in the app at runtime.
- **Facts-and-opinion coaching.** Output is observations measured against best practices, plus opinions labeled as opinions. No motivational copy.
- **Not a medical device.** No diagnoses; safety guardrails and professional-evaluation flags are part of the design.

## License

All Rights Reserved. © Wade Feltman.
