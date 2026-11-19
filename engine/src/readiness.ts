// Readiness engine (spec v1.0 §4).
//
// Daily tier from Wade's own baselines, not population norms:
// HRV vs 7-day / 28-day baseline, sleep duration and score vs need,
// Body Battery peak, resting-HR deviation, and recent load
// (acute:chronic workload ratio). Tiers gate intensity:
// green = planned hard session, yellow = moderate,
// red = walk / mobility / recovery only.
//
// Degradation (spec §3): when inputs are missing or stale, the
// result states its reduced confidence and which inputs are missing.
// Nothing is filled in with invented values.

import type { InjuryRecord, MovementPattern, Observation, WorkoutRecord } from "./model.ts";
import { dailySeries, resolveObservations } from "./priority.ts";

export type Tier = "green" | "yellow" | "red";
export type Confidence = "high" | "medium" | "low";

export interface ReadinessSignal {
  name: string;
  /** Factual statement of what the data shows. */
  detail: string;
  /** -1 suppressing, 0 neutral, +1 supporting. */
  effect: -1 | 0 | 1;
}

export interface ReadinessResult {
  date: string;
  tier: Tier;
  score: number;
  confidence: Confidence;
  missingInputs: string[];
  signals: ReadinessSignal[];
  /** Per-pattern tier overrides when an injury is active (§4, §7). */
  perPattern: Partial<Record<MovementPattern, Tier>>;
  acwr: number | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function seriesBefore(
  resolved: Observation[],
  metric: Observation["metric"],
  asOf: string,
  days: number,
  includeAsOf: boolean,
): number[] {
  return dailySeries(resolved, metric)
    .filter((p) => {
      const d = daysBetween(p.date, asOf);
      return includeAsOf ? d >= 0 && d < days : d > 0 && d <= days;
    })
    .map((p) => p.value);
}

function valueOn(resolved: Observation[], metric: Observation["metric"], date: string): number | null {
  const found = dailySeries(resolved, metric).find((p) => p.date === date);
  return found ? found.value : null;
}

/** Acute:chronic workload ratio from workout load (spec §5: keep
 *  roughly 0.8–1.3). Acute = mean daily load over the last 7 days,
 *  chronic = mean daily load over the last 28 days. */
export function acuteChronicWorkloadRatio(workouts: WorkoutRecord[], asOf: string): number | null {
  const loadIn = (days: number) =>
    workouts
      .filter((w) => {
        const d = daysBetween(w.startAt.slice(0, 10), asOf);
        return d >= 0 && d < days;
      })
      .reduce((sum, w) => sum + (w.load ?? 0), 0) / days;
  const chronic = loadIn(28);
  if (chronic <= 0) return null;
  return loadIn(7) / chronic;
}

export function computeReadiness(
  observations: Observation[],
  workouts: WorkoutRecord[],
  injuries: InjuryRecord[],
  asOf: string,
): ReadinessResult {
  const resolved = resolveObservations(observations);
  const signals: ReadinessSignal[] = [];
  const missing: string[] = [];
  let score = 0;

  // HRV vs personal baselines.
  const hrvToday = valueOn(resolved, "hrv-ms", asOf);
  const hrv7 = mean(seriesBefore(resolved, "hrv-ms", asOf, 7, false));
  const hrv28 = mean(seriesBefore(resolved, "hrv-ms", asOf, 28, false));
  if (hrvToday !== null && hrv7 !== null) {
    const ratio = hrvToday / hrv7;
    const effect = ratio >= 0.95 ? 1 : ratio >= 0.85 ? 0 : -1;
    score += effect;
    signals.push({
      name: "hrv",
      detail: `HRV ${Math.round(hrvToday)} ms against a 7-day average of ${Math.round(hrv7)} ms` +
        (hrv28 !== null ? ` and a 28-day average of ${Math.round(hrv28)} ms` : "") + ".",
      effect: effect as -1 | 0 | 1,
    });
  } else missing.push("hrv");

  // Sleep: duration vs need (or vs personal average), plus score.
  const sleepMin = valueOn(resolved, "sleep-duration-min", asOf);
  const sleepNeed = valueOn(resolved, "sleep-need-min", asOf);
  const sleepAvg = mean(seriesBefore(resolved, "sleep-duration-min", asOf, 28, false));
  const sleepScore = valueOn(resolved, "sleep-score", asOf);
  if (sleepMin !== null) {
    const reference = sleepNeed ?? sleepAvg;
    let effect: -1 | 0 | 1 = 0;
    if (reference !== null) {
      const ratio = sleepMin / reference;
      effect = ratio >= 0.9 ? 1 : ratio >= 0.75 ? 0 : -1;
    }
    if (sleepScore !== null) {
      if (sleepScore < 50) effect = -1;
      else if (sleepScore < 65 && effect > 0) effect = 0;
    }
    score += effect;
    signals.push({
      name: "sleep",
      detail: `Sleep ${Math.floor(sleepMin / 60)}h ${String(Math.round(sleepMin % 60)).padStart(2, "0")}m` +
        (reference !== null ? ` against a need/reference of ${Math.round(reference / 60 * 10) / 10}h` : "") +
        (sleepScore !== null ? `, score ${Math.round(sleepScore)}` : "") + ".",
      effect,
    });
  } else missing.push("sleep");

  // Body Battery peak vs personal average.
  const bbToday = valueOn(resolved, "body-battery-peak", asOf);
  const bbAvg = mean(seriesBefore(resolved, "body-battery-peak", asOf, 28, false));
  if (bbToday !== null) {
    let effect: -1 | 0 | 1;
    if (bbAvg !== null) {
      const diff = bbToday - bbAvg;
      effect = diff >= 5 ? 1 : diff >= -10 ? 0 : -1;
    } else {
      effect = bbToday >= 70 ? 1 : bbToday >= 40 ? 0 : -1;
    }
    score += effect;
    signals.push({
      name: "body-battery",
      detail: `Body Battery peak ${Math.round(bbToday)}` +
        (bbAvg !== null ? ` against a 28-day average peak of ${Math.round(bbAvg)}` : "") + ".",
      effect,
    });
  } else missing.push("body-battery");

  // Resting HR deviation from personal baseline.
  const rhrToday = valueOn(resolved, "resting-hr-bpm", asOf);
  const rhrAvg = mean(seriesBefore(resolved, "resting-hr-bpm", asOf, 28, false));
  if (rhrToday !== null && rhrAvg !== null) {
    const dev = rhrToday - rhrAvg;
    const effect = dev <= 1 ? 1 : dev <= 3 ? 0 : -1;
    score += effect;
    signals.push({
      name: "resting-hr",
      detail: `Resting HR ${Math.round(rhrToday)} bpm against a 28-day average of ${Math.round(rhrAvg)} bpm.`,
      effect: effect as -1 | 0 | 1,
    });
  } else missing.push("resting-hr");

  // Load: ACWR above the 0.8–1.3 band caps the tier at yellow.
  // Backtest finding (Phase 1, Nov 2026 data): an earlier rule that
  // capped at red above 1.5 forced red on days whose other signals
  // were strongly positive (score +3), because a ramp-up after a
  // quiet period inflates the ratio on its own. Load management
  // reduces intensity; it does not by itself order full recovery.
  const acwr = acuteChronicWorkloadRatio(workouts, asOf);
  let tierCap: Tier | null = null;
  if (acwr !== null && acwr > 1.3) {
    tierCap = "yellow";
    signals.push({
      name: "load",
      detail: `Acute:chronic workload ratio ${acwr.toFixed(2)}, above the 0.8–1.3 band.`,
      effect: -1,
    });
  }

  let tier: Tier = score >= 1 ? "green" : score >= -1 ? "yellow" : "red";
  if (tierCap === "yellow" && tier === "green") tier = "yellow";

  // Confidence: signal coverage + freshness of the latest data.
  const present = 4 - missing.length;
  const latestDate = resolved.length > 0 ? resolved[resolved.length - 1].date : null;
  const staleDays = latestDate ? daysBetween(latestDate, asOf) : null;
  let confidence: Confidence = present >= 4 ? "high" : present >= 3 ? "medium" : "low";
  if (staleDays !== null && staleDays > 3 && confidence === "high") confidence = "medium";
  if (staleDays !== null && staleDays > 7) confidence = "low";

  // Injury splits (§4/§7): affected patterns are red while the injury
  // is in stage 1 (settle), capped at yellow in stage 2 (reload),
  // and unrestricted in stage 3 (return).
  const perPattern: Partial<Record<MovementPattern, Tier>> = {};
  for (const injury of injuries) {
    if (injury.status === "resolved") continue;
    const cap: Tier = injury.stage === 1 ? "red" : injury.stage === 2 ? "yellow" : tier;
    for (const pattern of injury.affectedPatterns) {
      const existing = perPattern[pattern];
      if (!existing || cap === "red" || (cap === "yellow" && existing === "green")) {
        perPattern[pattern] = cap;
      }
    }
  }

  return { date: asOf, tier, score, confidence, missingInputs: missing, signals, perPattern, acwr };
}
