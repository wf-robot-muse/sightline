# SightLine

SightLine is a personalized health and training app: it builds daily workout, activity, and nutrition recommendations from the user's own health data and goals, weighted by the priority the user sets, and replans on the fly as conditions change.

**Status:** Phase 4 (v0.4.0) — shadow mode and releases. Phase 1 delivered the engine (canonical data model, adapters, readiness, weighted goals, planner, nutrition) with its test suite and a backtest against real recorded data. Phase 2 added the desktop app (Today, Goals & weights, Check-ins, Fasting log, Injury log, Equipment, Data, Settings). Phase 3 added workout export (FIT), injury staged return paths, and nutrition scoring. Phase 4 adds shadow mode (the app recommends, the user trains as they choose, and the app compares and tunes) and the release pipelines below. All local-first; all data stays on the user's machine. The design spec is approved (v1.0, 2026-11-18) and is the build reference. The spec itself is maintained outside this public repo.

## Releases

- **Windows** — NSIS installer attached to each versioned GitHub Release, Authenticode-signed with the project owner's self-signed certificate (SHA-256 fingerprint `AF:FA:FC:91:08:15:72:F0:81:C9:F0:78:3A:59:59:5E:61:F4:BE:00:D8:F3:77:CA:55:82:DD:3D:52:CE:62:B3`). A self-signed signature is tamper evidence, not Microsoft trust — SmartScreen may still warn.
- **macOS** — DMG (Apple Silicon) attached to each GitHub Release, unsigned; first launch needs a right-click Open.
- **Web** — the same build published on GitHub Pages at https://wf-robot-muse.github.io/sightline/ — data stays in the visitor's own browser storage.

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
| Window | 1024 × 720, title `SightLine` |

## Principles (from the approved spec)

- **Source-resilient data layer.** The engine talks to a canonical data model, never to a vendor. Every data source is a replaceable adapter, and every metric has a manual-entry path — the engine runs end-to-end on manual-only data.
- **Runtime data, never hardcoded.** Goals, deadlines, priority weights, equipment lists, and routines are user data entered and changed in the app at runtime.
- **Facts-and-opinion coaching.** Output is observations measured against best practices, plus opinions labeled as opinions. No motivational copy.
- **Not a medical device.** No diagnoses; safety guardrails and professional-evaluation flags are part of the design.

## License

All Rights Reserved. © Wade Feltman.
