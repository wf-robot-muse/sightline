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

export const ENGINE_VERSION = "0.1.0";
