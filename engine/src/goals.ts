// Weighted-goal engine (spec v1.0 §2).
//
// Goals are runtime user data: type, measurable target, deadline,
// priority weight. Weights normalize across active goals and drive
// allocation. Conflicts are resolved openly, by weight (§2.3). Pace
// is tracked per goal, and the engine adjusts only inside hard
// safety bounds — it reports a deadline at risk instead of breaking
// the bounds (§2.3).

import type { Goal, GoalType } from "./model.ts";
import { ValidationError } from "./validate.ts";

export interface NormalizedGoal extends Goal {
  /** Weight as a fraction of total active weight (0..1). */
  normalizedWeight: number;
}

export function normalizeGoals(goals: Goal[]): NormalizedGoal[] {
  const active = goals.filter((g) => g.active);
  for (const g of active) {
    if (!(g.weight > 0) || !Number.isFinite(g.weight)) {
      throw new ValidationError(`goal.${g.id}.weight`, "active goals need a positive weight");
    }
  }
  const total = active.reduce((sum, g) => sum + g.weight, 0);
  if (total <= 0) return [];
  return active.map((g) => ({ ...g, normalizedWeight: g.weight / total }));
}

/** A candidate session/practice/food decision, scored per goal type
 *  by relevance 0..1 (how directly it serves that goal type). */
export interface Candidate {
  id: string;
  relevance: Partial<Record<GoalType, number>>;
}

export function scoreCandidate(candidate: Candidate, goals: NormalizedGoal[]): number {
  let score = 0;
  for (const goal of goals) {
    const relevance = candidate.relevance[goal.type] ?? 0;
    if (relevance < 0 || relevance > 1) {
      throw new ValidationError(`candidate.${candidate.id}.relevance`, "relevance must be 0..1");
    }
    score += relevance * goal.normalizedWeight;
  }
  return score;
}

export function rankCandidates(candidates: Candidate[], goals: NormalizedGoal[]): Candidate[] {
  return [...candidates].sort((a, b) => scoreCandidate(b, goals) - scoreCandidate(a, goals));
}

export type EnergyMode = "deficit" | "recomp" | "maintenance" | "surplus";

export interface ConflictResolution {
  mode: EnergyMode;
  /** Factual statement of the tradeoff, shown to the user (§2.3). */
  explanation: string;
}

/** Fat loss and muscle building pull against each other. With both
 *  materially weighted, the engine runs recomp: a moderate deficit
 *  with a high protein floor and progressive strength work, rather
 *  than pretending both can be maximized (§2.3). */
export function resolveEnergyMode(goals: NormalizedGoal[]): ConflictResolution {
  const fatLoss = goals.find((g) => g.type === "fat-loss")?.normalizedWeight ?? 0;
  const muscle = goals.find((g) => g.type === "muscle")?.normalizedWeight ?? 0;
  if (fatLoss >= 0.2 && muscle >= 0.2) {
    return {
      mode: "recomp",
      explanation:
        `Fat loss (${Math.round(fatLoss * 100)}%) and muscle (${Math.round(muscle * 100)}%) are both ` +
        "materially weighted. They pull against each other, so the engine runs a moderate deficit " +
        "with a high protein floor and progressive strength work (recomp) instead of maximizing either.",
    };
  }
  if (fatLoss >= 0.2) return { mode: "deficit", explanation: "Fat loss is the dominant energy goal: a deficit applies." };
  if (muscle >= 0.2) return { mode: "surplus", explanation: "Muscle is the dominant energy goal: a small surplus applies." };
  return { mode: "maintenance", explanation: "Neither fat loss nor muscle is materially weighted: energy targets sit at maintenance." };
}

export interface PaceResult {
  goalId: string;
  /** Units per week, in the goal target's own units. */
  actualRatePerWeek: number | null;
  requiredRatePerWeek: number | null;
  /** The rate the engine will actually plan to, after safety bounds. */
  appliedRatePerWeek: number | null;
  deadlineAtRisk: boolean;
  detail: string;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Pace tracking for one goal. `safeMaxRatePerWeek` is the hard bound
 *  the engine will not cross (e.g. for fat loss, ~1% of body weight
 *  per week, supplied by the caller from current weight). */
export function trackPace(args: {
  goal: Goal;
  startValue: number;
  currentValue: number;
  startDate: string;
  asOf: string;
  safeMaxRatePerWeek: number | null;
}): PaceResult {
  const { goal, startValue, currentValue, startDate, asOf, safeMaxRatePerWeek } = args;
  const elapsedDays = Math.max(1, daysBetween(startDate, asOf));
  const progress = Math.abs(currentValue - startValue);
  const actualRate = (progress / elapsedDays) * 7;

  if (goal.target === null || goal.deadline === null) {
    return {
      goalId: goal.id,
      actualRatePerWeek: actualRate,
      requiredRatePerWeek: null,
      appliedRatePerWeek: actualRate,
      deadlineAtRisk: false,
      detail: "Open-ended goal (no deadline): pace is reported, not chased.",
    };
  }
  const remaining = Math.abs(goal.target - currentValue);
  const daysLeft = daysBetween(asOf, goal.deadline);
  if (daysLeft <= 0) {
    return {
      goalId: goal.id,
      actualRatePerWeek: actualRate,
      requiredRatePerWeek: null,
      appliedRatePerWeek: safeMaxRatePerWeek,
      deadlineAtRisk: remaining > 0,
      detail: remaining > 0 ? "Deadline reached with the target unmet." : "Target met by the deadline.",
    };
  }
  const requiredRate = (remaining / daysLeft) * 7;
  let appliedRate = requiredRate;
  let atRisk = false;
  if (safeMaxRatePerWeek !== null && requiredRate > safeMaxRatePerWeek) {
    appliedRate = safeMaxRatePerWeek;
    atRisk = true;
  }
  return {
    goalId: goal.id,
    actualRatePerWeek: actualRate,
    requiredRatePerWeek: requiredRate,
    appliedRatePerWeek: appliedRate,
    deadlineAtRisk: atRisk,
    detail: atRisk
      ? `Deadline requires ${requiredRate.toFixed(2)}/week, above the safe bound of ` +
        `${safeMaxRatePerWeek!.toFixed(2)}/week. The engine plans to the safe bound; the deadline is at risk.`
      : `Deadline requires ${requiredRate.toFixed(2)}/week, inside the safe bound.`,
  };
}
