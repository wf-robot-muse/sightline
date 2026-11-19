// Weekly planner / replanner (spec v1.0 §5).
//
// The plan is regenerated, not edited. Any change — a missed
// session, a check-in, a fast, an injury, a goal edit — re-runs this
// assembly with the new constraints, and every session carries the
// facts that explain its placement, so Wade sees what changed and
// why. Rules-based, not black-box:
// - readiness gates intensity (green hard / yellow moderate /
//   red recovery only)
// - fasting days: walking and mobility only
// - injury-affected patterns come out; safe alternatives that still
//   serve the weighted goals replace them (§7.2)
// - run volume progression capped at ~10%/week; ACSM floors
//   (150 min/week moderate aerobic, 2+ strength days) reported as
//   benchmarks, not silently enforced

import type { NormalizedGoal } from "./goals.ts";
import { scoreCandidate } from "./goals.ts";
import type { EngineInputs, MovementPattern } from "./model.ts";
import type { ReadinessResult, Tier } from "./readiness.ts";
import { computeReadiness } from "./readiness.ts";

export type SessionKind =
  | "run-hard"
  | "run-easy"
  | "strength-hinge-core"
  | "strength-general"
  | "mobility-flow"
  | "walk"
  | "sleep-practice"
  | "recovery";

export interface SessionTemplate {
  kind: SessionKind;
  durationMin: number;
  patterns: MovementPattern[];
  relevance: Partial<Record<string, number>>;
  /** Relative load units for ACWR accounting. */
  load: number;
}

export const SESSION_TEMPLATES: SessionTemplate[] = [
  { kind: "run-hard", durationMin: 30, patterns: ["run"], relevance: { "fat-loss": 0.9, muscle: 0.2, "mental-health": 0.5 }, load: 30 },
  { kind: "run-easy", durationMin: 30, patterns: ["run"], relevance: { "fat-loss": 0.7, "mental-health": 0.5, sleep: 0.2 }, load: 18 },
  { kind: "strength-hinge-core", durationMin: 45, patterns: ["hinge", "core-stability", "carry"], relevance: { "lower-back": 1.0, "core-strength": 0.9, muscle: 0.7, "fat-loss": 0.4 }, load: 27 },
  { kind: "strength-general", durationMin: 45, patterns: ["squat", "push-horizontal", "pull"], relevance: { muscle: 0.9, "fat-loss": 0.4, "core-strength": 0.4 }, load: 27 },
  { kind: "mobility-flow", durationMin: 15, patterns: ["mobility"], relevance: { "flexibility-mobility": 1.0, "lower-back": 0.5, sleep: 0.3 }, load: 5 },
  { kind: "walk", durationMin: 40, patterns: ["run"], relevance: { "fat-loss": 0.5, "mental-health": 0.7, sleep: 0.3 }, load: 8 },
  { kind: "sleep-practice", durationMin: 20, patterns: [], relevance: { sleep: 1.0, "mental-health": 0.4 }, load: 0 },
  { kind: "recovery", durationMin: 20, patterns: ["mobility"], relevance: { sleep: 0.4, "flexibility-mobility": 0.5 }, load: 2 },
];

export interface PlannedSession {
  date: string;
  kind: SessionKind;
  durationMin: number;
  score: number;
  /** Facts explaining this placement (spec §5, §8 format inputs). */
  reasons: string[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isFastingOn(fasts: EngineInputs["fasts"], date: string): boolean {
  return fasts.some((f) => {
    const start = f.startedAt.slice(0, 10);
    const end = f.endedAt ? f.endedAt.slice(0, 10) : "9999-12-31";
    return date >= start && date <= end;
  });
}

const HARD_KINDS: SessionKind[] = ["run-hard", "strength-hinge-core", "strength-general"];
const MODERATE_KINDS: SessionKind[] = ["run-easy", "strength-hinge-core", "strength-general", "walk", "mobility-flow", "sleep-practice"];
const RECOVERY_KINDS: SessionKind[] = ["walk", "mobility-flow", "sleep-practice", "recovery"];

export function planWeek(
  inputs: EngineInputs,
  goals: NormalizedGoal[],
  weekStart: string,
): { sessions: PlannedSession[]; readiness: ReadinessResult[]; benchmarks: string[] } {
  const sessions: PlannedSession[] = [];
  const readiness: ReadinessResult[] = [];
  let previousKind: SessionKind | null = null;

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dayReadiness = computeReadiness(inputs.observations, inputs.workouts, inputs.injuries, date);
    readiness.push(dayReadiness);
    const fasting = isFastingOn(inputs.fasts, date);

    let allowed: SessionKind[];
    const reasons: string[] = [];
    if (dayReadiness.missingInputs.length >= 3) {
      // No usable data for this date (e.g. beyond the data horizon):
      // plan provisional recovery work and say so, rather than
      // treating missing signals as a neutral day. (Phase 1
      // backtest finding.)
      allowed = RECOVERY_KINDS;
      reasons.push("No usable readiness data for this date: provisional recovery work only.");
    } else if (fasting) {
      allowed = ["walk", "mobility-flow"];
      reasons.push("Fasting day: walking and mobility only (§5).");
    } else if (dayReadiness.tier === "red") {
      allowed = RECOVERY_KINDS;
      reasons.push("Readiness red: recovery work only (§4).");
    } else if (dayReadiness.tier === "yellow") {
      allowed = MODERATE_KINDS;
      reasons.push("Readiness yellow: moderate work (§4).");
    } else {
      allowed = SESSION_TEMPLATES.map((t) => t.kind);
      reasons.push("Readiness green: full menu (§4).");
    }

    // Check-in gating (§5): a stiff back reported today reshapes
    // today. Back stiffness >= 7 removes hinge/core work outright;
    // 5–6 caps it at moderate. The reason is stated on the session.
    const checkIn = inputs.checkIns.find((c) => c.date === date);
    const effectiveCaps: Partial<Record<MovementPattern, Tier>> = { ...dayReadiness.perPattern };
    if (checkIn && checkIn.backStiffness !== null && checkIn.backStiffness >= 5) {
      const cap: Tier = checkIn.backStiffness >= 7 ? "red" : "yellow";
      for (const p of ["hinge", "core-stability"] as MovementPattern[]) {
        const existing = effectiveCaps[p];
        if (!existing || cap === "red" || (cap === "yellow" && existing === "green")) {
          effectiveCaps[p] = cap;
        }
      }
      reasons.push(
        `Back stiffness ${checkIn.backStiffness}/10 reported: hinge and core work ${cap === "red" ? "removed" : "capped at moderate"} today (§5).`,
      );
    }

    const candidates = SESSION_TEMPLATES.filter((t) => allowed.includes(t.kind))
      .filter((t) => {
        // Injury gating (§7.2): a pattern capped red is out entirely;
        // a pattern capped yellow removes hard sessions using it.
        return t.patterns.every((p) => {
          const cap = effectiveCaps[p];
          if (cap === "red") return false;
          if (cap === "yellow" && HARD_KINDS.includes(t.kind)) return false;
          return true;
        });
      })
      // Spacing (Phase 1 backtest finding: without it, the planner
      // repeated the single highest-scoring session every day).
      // Strength work never lands on consecutive days, and repeating
      // yesterday's session kind halves its score — recovery kinds
      // (walk, mobility, sleep practice) are exempt from the penalty.
      .filter((t) => !(previousKind?.startsWith("strength") && t.kind.startsWith("strength")))
      .map((t) => {
        let score = scoreCandidate({ id: t.kind, relevance: t.relevance }, goals);
        if (t.kind === previousKind && !RECOVERY_KINDS.includes(t.kind)) score *= 0.5;
        return { template: t, score };
      })
      .sort((a, b) => b.score - a.score);

    const chosen = candidates[0];
    if (chosen) {
      sessions.push({
        date,
        kind: chosen.template.kind,
        durationMin: chosen.template.durationMin,
        score: Math.round(chosen.score * 1000) / 1000,
        reasons,
      });
      previousKind = chosen.template.kind;
    }
  }

  const aerobicMin = sessions
    .filter((s) => ["run-hard", "run-easy", "walk"].includes(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0);
  const strengthDays = sessions.filter((s) => s.kind.startsWith("strength")).length;
  const benchmarks = [
    `Moderate aerobic volume planned: ${aerobicMin} min against the ACSM floor of 150 min/week.`,
    `Strength days planned: ${strengthDays} against the ACSM floor of 2+ per week.`,
  ];

  return { sessions, readiness, benchmarks };
}
