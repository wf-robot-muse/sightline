// Nutrition engine (spec v1.0 §6) — adaptive, MacroFactor-style.
//
// Actual expenditure is estimated from the weight trend plus logged
// intake, then targets are set from the weighted goals. Ordering
// rule (locked, §6): protein is set first (scales with the muscle
// weight), the deficit second (scales with the fat-loss weight), and
// carbs are what is left after those two are set — inside Wade's
// low-carb ceiling. Fasting days switch to electrolyte/hydration
// targets and a staged refeed (§6.3).

import type { NormalizedGoal } from "./goals.ts";
import { resolveEnergyMode } from "./goals.ts";
import type { NutritionDay, Observation } from "./model.ts";
import { dailySeries, resolveObservations } from "./priority.ts";

const KCAL_PER_KG = 7700;
const LB_PER_KG = 2.20462;

export interface ExpenditureEstimate {
  kcalPerDay: number | null;
  detail: string;
}

/** Energy-balance estimate: expenditure = mean intake + energy
 *  released by weight change over the window. Needs both a weight
 *  trend (>= 2 weigh-ins spanning >= 7 days) and logged intake;
 *  returns null rather than guessing when either is missing. */
export function estimateExpenditure(
  observations: Observation[],
  nutrition: NutritionDay[],
): ExpenditureEstimate {
  const weights = dailySeries(resolveObservations(observations), "weight-kg");
  if (weights.length < 2) {
    return { kcalPerDay: null, detail: "Expenditure not estimated: fewer than two weigh-ins on record." };
  }
  const first = weights[0];
  const last = weights[weights.length - 1];
  const days = Math.max(
    1,
    Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400000),
  );
  if (days < 7) {
    return { kcalPerDay: null, detail: "Expenditure not estimated: weigh-ins span less than 7 days." };
  }
  const logged = nutrition.filter((d) => d.kcal !== null && d.date >= first.date && d.date <= last.date);
  if (logged.length < 3) {
    return { kcalPerDay: null, detail: "Expenditure not estimated: fewer than three logged intake days in the window." };
  }
  const meanIntake = logged.reduce((s, d) => s + (d.kcal ?? 0), 0) / logged.length;
  const weightDeltaKg = last.value - first.value;
  const expenditure = meanIntake - (weightDeltaKg * KCAL_PER_KG) / days;
  return {
    kcalPerDay: Math.round(expenditure),
    detail:
      `Estimated from ${logged.length} logged days (mean intake ${Math.round(meanIntake)} kcal) and a ` +
      `weight change of ${weightDeltaKg.toFixed(1)} kg over ${days} days.`,
  };
}

export interface MicroTargets {
  sodiumMg: [number, number];
  potassiumMg: [number, number];
  magnesiumMg: [number, number];
  fiberG: [number, number];
  vitaminDIuFloor: number;
  omega3G: [number, number];
  calciumMg: number;
}

/** General daily references from spec §6.2 — the nutrients Wade's
 *  goal mix turns on. General nutrition information, not medical
 *  advice. */
export const MICRO_TARGETS: MicroTargets = {
  sodiumMg: [3000, 5000],
  potassiumMg: [3400, 4700],
  magnesiumMg: [400, 600],
  fiberG: [25, 30],
  vitaminDIuFloor: 800,
  omega3G: [1, 3],
  calciumMg: 1000,
};

export interface NutritionTargets {
  mode: "fed" | "fasting";
  kcal: number | null;
  proteinG: number | null;
  carbsNetG: number | null;
  fatG: number | null;
  micros: MicroTargets;
  /** Extra tracked targets switched on by goal weights (§6.3). */
  trackedFocus: string[];
  detail: string[];
}

export function computeNutritionTargets(args: {
  goals: NormalizedGoal[];
  bodyWeightKg: number | null;
  expenditureKcal: number | null;
  fastingToday: boolean;
}): NutritionTargets {
  const { goals, bodyWeightKg, expenditureKcal, fastingToday } = args;
  const detail: string[] = [];
  const micros = MICRO_TARGETS;

  const trackedFocus: string[] = [];
  const weightOf = (t: string) => goals.find((g) => g.type === t)?.normalizedWeight ?? 0;
  if (weightOf("sleep") >= 0.15) trackedFocus.push("caffeine-cutoff-10am", "magnesium-evening", "early-last-meal");
  if (weightOf("mental-health") >= 0.15) trackedFocus.push("omega-3", "vitamin-d", "alcohol-flag");
  if (weightOf("lower-back") >= 0.15 || weightOf("core-strength") >= 0.15) {
    trackedFocus.push("protein-floor-hard", "vitamin-d", "calcium");
  }

  if (fastingToday) {
    detail.push("Fasting day: calorie and carb targets drop out; electrolyte and hydration targets apply (§6.3).");
    detail.push("Refeed is staged: protein-forward first meal (~40–50 g protein), fats moderate, carbs per ceiling.");
    return { mode: "fasting", kcal: null, proteinG: null, carbsNetG: null, fatG: null, micros, trackedFocus, detail };
  }

  if (bodyWeightKg === null || expenditureKcal === null) {
    detail.push("Fed-day targets need a current weight and an expenditure estimate; one or both are missing, so no targets are invented.");
    return { mode: "fed", kcal: null, proteinG: null, carbsNetG: null, fatG: null, micros, trackedFocus, detail };
  }

  const { mode, explanation } = resolveEnergyMode(goals);
  detail.push(explanation);

  const weightLb = bodyWeightKg * LB_PER_KG;
  const muscleW = weightOf("muscle");
  const fatLossW = weightOf("fat-loss");

  // 1) Protein first (§6 ordering rule): 0.75 g/lb at no muscle
  //    weight, rising to ~0.95 g/lb when muscle dominates.
  const proteinPerLb = 0.75 + 0.2 * Math.min(1, muscleW * 2);
  const proteinG = Math.round(weightLb * proteinPerLb);

  // 2) Deficit second: scales with the fat-loss weight; recomp runs
  //    a moderate deficit, muscle-led runs near maintenance (§6.1).
  let kcal = expenditureKcal;
  if (mode === "deficit") kcal = expenditureKcal - Math.round(300 + 250 * fatLossW);
  else if (mode === "recomp") kcal = expenditureKcal - 300;
  else if (mode === "surplus") kcal = expenditureKcal + 200;

  // 3) Carbs are what is left, inside the low-carb pattern: keto
  //    range when fat loss dominates, more room as muscle weight
  //    rises (§6.1 scenarios A and B are the reference points).
  const carbsNetG = fatLossW >= 0.45 ? 40 : Math.round(40 + Math.max(0, muscleW - 0.3) * 175);

  // Fat fills the remainder.
  const remainingKcal = kcal - proteinG * 4 - carbsNetG * 4;
  const fatG = Math.max(0, Math.round(remainingKcal / 9));

  detail.push(
    `Protein ${proteinG} g (${proteinPerLb.toFixed(2)} g/lb) set first; energy ${kcal} kcal in ${mode} mode; ` +
      `carbs ${carbsNetG} g net; fat ${fatG} g fills the remainder.`,
  );
  return { mode: "fed", kcal, proteinG, carbsNetG, fatG, micros, trackedFocus, detail };
}

// ---- Scoring logged days against targets (Phase 3) ----

export type NutrientStatus = "met" | "low" | "high" | "not-logged";

export interface NutrientScore {
  nutrient: string;
  actual: number | null;
  target: number | null;
  unit: string;
  status: NutrientStatus;
  note: string;
}

const within = (actual: number, target: number, tolerance: number) =>
  actual >= target * (1 - tolerance) && actual <= target * (1 + tolerance);

/** Score one logged day against fed-day targets. A nutrient absent
 *  from the log scores "not-logged", never zero (§3.1 partial
 *  coverage). Scoring against fasting-day targets is not attempted:
 *  the day is reported as a fasting day instead. */
export function scoreNutritionDay(day: NutritionDay, targets: NutritionTargets): NutrientScore[] {
  if (targets.mode === "fasting") return [];
  const scores: NutrientScore[] = [];
  const macro = (
    nutrient: string,
    actual: number | null | undefined,
    target: number | null,
    unit: string,
    opts: { ceiling?: boolean; tolerance?: number } = {},
  ) => {
    if (actual === null || actual === undefined) {
      scores.push({ nutrient, actual: null, target, unit, status: "not-logged", note: "Not present in the day's log." });
      return;
    }
    if (target === null) {
      scores.push({ nutrient, actual, target: null, unit, status: "not-logged", note: "No target computed for this day." });
      return;
    }
    let status: NutrientStatus;
    let note: string;
    if (opts.ceiling) {
      status = actual <= target ? "met" : "high";
      note = status === "met" ? `At or under the ${target} ${unit} ceiling.` : `${actual - target} ${unit} over the ceiling.`;
    } else if (within(actual, target, opts.tolerance ?? 0.1)) {
      status = "met"; note = "Within 10% of target.";
    } else if (actual < target) {
      status = "low"; note = `${target - actual} ${unit} under target.`;
    } else {
      status = "high"; note = `${actual - target} ${unit} over target.`;
    }
    scores.push({ nutrient, actual, target, unit, status, note });
  };

  macro("Energy", day.kcal, targets.kcal, "kcal");
  macro("Protein", day.proteinG, targets.proteinG, "g");
  macro("Net carbs", day.carbsNetG, targets.carbsNetG, "g", { ceiling: true });
  macro("Fat", day.fatG, targets.fatG, "g");

  const micro = (
    nutrient: string,
    actual: number | null | undefined,
    lo: number,
    hi: number | null,
    unit: string,
  ) => {
    if (actual === null || actual === undefined) {
      scores.push({ nutrient, actual: null, target: lo, unit, status: "not-logged", note: "Not present in the day's log." });
      return;
    }
    const status: NutrientStatus = actual < lo ? "low" : hi !== null && actual > hi ? "high" : "met";
    const note =
      status === "met"
        ? hi !== null ? `Inside the ${lo}–${hi} ${unit} range.` : `At or over the ${lo} ${unit} floor.`
        : status === "low" ? `Under the ${lo} ${unit} floor.` : `Over the ${hi} ${unit} ceiling.`;
    scores.push({ nutrient, actual, target: lo, unit, status, note });
  };
  const m = targets.micros;
  micro("Fiber", day.fiberG, m.fiberG[0], m.fiberG[1], "g");
  micro("Sodium", day.sodiumMg, m.sodiumMg[0], m.sodiumMg[1], "mg");
  micro("Potassium", day.potassiumMg, m.potassiumMg[0], m.potassiumMg[1], "mg");
  micro("Magnesium", day.magnesiumMg, m.magnesiumMg[0], m.magnesiumMg[1], "mg");
  micro("Vitamin D", day.vitaminDIu, m.vitaminDIuFloor, null, "IU");
  micro("Calcium", day.calciumMg, m.calciumMg, null, "mg");
  micro("Omega-3 EPA+DHA", day.omega3G, m.omega3G[0], m.omega3G[1], "g");
  return scores;
}

export interface NutritionWeekScore {
  loggedDays: number;
  /** Average status counts across logged days, per nutrient. */
  byNutrient: { nutrient: string; met: number; low: number; high: number; notLogged: number }[];
}

export function scoreNutritionWeek(days: NutritionDay[], targets: NutritionTargets): NutritionWeekScore {
  const map = new Map<string, { nutrient: string; met: number; low: number; high: number; notLogged: number }>();
  for (const day of days) {
    for (const s of scoreNutritionDay(day, targets)) {
      const row = map.get(s.nutrient) ?? { nutrient: s.nutrient, met: 0, low: 0, high: 0, notLogged: 0 };
      if (s.status === "met") row.met++;
      else if (s.status === "low") row.low++;
      else if (s.status === "high") row.high++;
      else row.notLogged++;
      map.set(s.nutrient, row);
    }
  }
  return { loggedDays: days.length, byNutrient: [...map.values()] };
}
