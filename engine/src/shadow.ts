// Shadow-mode comparison (spec v1.0 §9, plan Phase 4).
//
// Shadow mode: the app recommends, the user trains as they choose,
// and this report compares the two — facts only. It exists to tune
// thresholds with evidence: how often plans were followed, what was
// substituted, and what training happened on red days. It never
// grades the user; it grades the app's recommendations.

import type { EngineInputs, WorkoutKind } from "./model.ts";
import type { NormalizedGoal } from "./goals.ts";
import type { PlannedSession } from "./planner.ts";
import { planWeek } from "./planner.ts";
import { computeReadiness } from "./readiness.ts";
import type { Tier as ReadinessTier } from "./readiness.ts";

export type ShadowOutcome =
  | "followed"
  | "substituted"
  | "missed"
  | "extra"
  | "rest-followed"
  | "trained-on-recovery"
  | "upcoming";

export interface ShadowDay {
  date: string;
  planned: PlannedSession | null;
  actualKinds: WorkoutKind[];
  outcome: ShadowOutcome;
  readinessTier: ReadinessTier;
}

export interface ShadowWeekReport {
  weekStart: string;
  days: ShadowDay[];
  counts: Record<ShadowOutcome, number>;
  /** Factual summary lines for the weekly review. */
  lines: string[];
}

const KIND_GROUP: Record<PlannedSession["kind"], WorkoutKind | null> = {
  "run-easy": "run",
  "run-hard": "run",
  "strength-hinge-core": "strength",
  "strength-general": "strength",
  "walk": "walk",
  "mobility-flow": "mobility",
  "recovery": null,
  "sleep-practice": null,
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function shadowWeek(
  inputs: EngineInputs,
  goals: NormalizedGoal[],
  weekStart: string,
  asOf: string,
): ShadowWeekReport {
  const plan = planWeek(inputs, goals, weekStart);
  const plannedByDate = new Map(plan.sessions.map((s) => [s.date, s]));
  const counts: Record<ShadowOutcome, number> = {
    followed: 0, substituted: 0, missed: 0, extra: 0,
    "rest-followed": 0, "trained-on-recovery": 0, upcoming: 0,
  };
  const days: ShadowDay[] = [];
  let trainedOnRed = 0;
  let hardOnRed = 0;

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const planned = plannedByDate.get(date) ?? null;
    const actual = inputs.workouts.filter((w) => w.startAt.slice(0, 10) === date);
    const actualKinds = actual.map((w) => w.kind);
    const readiness = computeReadiness(inputs.observations, inputs.workouts, inputs.injuries, date);
    let outcome: ShadowOutcome;
    if (date > asOf) {
      outcome = "upcoming";
    } else if (!planned && actual.length === 0) {
      outcome = "rest-followed";
    } else if (!planned) {
      outcome = "extra";
    } else {
      const group = KIND_GROUP[planned.kind];
      if (group === null) {
        outcome = actual.length === 0 ? "rest-followed" : "trained-on-recovery";
      } else if (actualKinds.includes(group)) {
        outcome = "followed";
      } else if (actual.length > 0) {
        outcome = "substituted";
      } else {
        outcome = "missed";
      }
    }
    counts[outcome]++;
    if (actual.length > 0 && readiness.tier === "red") {
      trainedOnRed++;
      if (planned && (planned.kind === "run-hard" || planned.kind.startsWith("strength"))) hardOnRed++;
    }
    days.push({ date, planned, actualKinds, outcome, readinessTier: readiness.tier });
  }

  const decided = counts.followed + counts.substituted + counts.missed;
  const lines: string[] = [
    `Planned sessions decided so far: ${decided} — followed ${counts.followed}, substituted ${counts.substituted}, missed ${counts.missed}.`,
    `Unplanned training days: ${counts.extra}. Recovery days trained through: ${counts["trained-on-recovery"]}.`,
    `Days with training on a red readiness tier: ${trainedOnRed}.`,
  ];
  if (trainedOnRed > 0) {
    lines.push("Shadow-mode question for the weekly review: did the red tier call those days right? That judgment tunes thresholds — it is not made automatically.");
  }
  return { weekStart, days, counts, lines };
}
