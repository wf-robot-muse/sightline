// SightLine engine — platform-independent recommendation logic.
//
// Boundary rules (approved spec v1.0, §11.2):
// - This module contains ONLY pure logic: goal scoring, readiness,
//   replanning, injury gating, nutrition targets.
// - It must never import UI code, Tauri APIs, or vendor SDKs.
// - All health data arrives through the canonical data model
//   (adapters live outside the engine); every value carries provenance.
// - Goals, deadlines, weights, equipment, and routines are runtime
//   user data passed in as inputs — never constants in this module.

export const ENGINE_VERSION = "0.4.0";

export * from "./model.ts";
export * from "./validate.ts";
export * from "./priority.ts";
export * from "./readiness.ts";
export * from "./goals.ts";
export * from "./nutrition.ts";
export * from "./planner.ts";
export * from "./coaching.ts";
export * from "./adapters/manual.ts";
export * from "./adapters/garmin.ts";
export * from "./adapters/teladoc.ts";
export * from "./adapters/cronometer.ts";
export * from "./workout.ts";
export * from "./fit.ts";
export * from "./injury.ts";
export * from "./shadow.ts";
