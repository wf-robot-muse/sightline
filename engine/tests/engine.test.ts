import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveObservations } from "../src/priority.ts";
import { computeReadiness } from "../src/readiness.ts";
import { normalizeGoals, resolveEnergyMode, scoreCandidate, trackPace } from "../src/goals.ts";
import { computeNutritionTargets, estimateExpenditure } from "../src/nutrition.ts";
import { planWeek } from "../src/planner.ts";
import { assertCoachingVoice, formatStatement } from "../src/coaching.ts";
import type { EngineInputs, Goal, InjuryRecord, Observation } from "../src/model.ts";
import { ENTERED, obs } from "./fixtures.ts";

function baselineDays(endDate: string, days: number, fill: (d: string) => Observation[]): Observation[] {
  const out: Observation[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (let i = 1; i <= days; i++) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    out.push(...fill(d));
  }
  return out;
}

const goodDay = (d: string): Observation[] => [
  obs("hrv-ms", 50, d),
  obs("sleep-duration-min", 470, d),
  obs("sleep-score", 75, d),
  obs("body-battery-peak", 70, d),
  obs("resting-hr-bpm", 54, d),
];

test("source priority: garmin steps win over apple-health, both kept in storage", () => {
  const all = [
    obs("steps", 8000, "2026-01-10", "apple-health"),
    obs("steps", 9500, "2026-01-10", "garmin"),
  ];
  const resolved = resolveObservations(all);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].value, 9500);
  assert.equal(resolved[0].provenance.source, "garmin");
});

test("readiness: a good day against baseline is green", () => {
  const observations = [...baselineDays("2026-01-10", 28, goodDay), ...goodDay("2026-01-10")];
  const r = computeReadiness(observations, [], [], "2026-01-10");
  assert.equal(r.tier, "green");
  assert.equal(r.confidence, "high");
});

test("readiness: suppressed HRV and short poor sleep is red", () => {
  const observations = [
    ...baselineDays("2026-01-10", 28, goodDay),
    obs("hrv-ms", 30, "2026-01-10"),
    obs("sleep-duration-min", 300, "2026-01-10"),
    obs("sleep-score", 40, "2026-01-10"),
    obs("body-battery-peak", 35, "2026-01-10"),
    obs("resting-hr-bpm", 60, "2026-01-10"),
  ];
  const r = computeReadiness(observations, [], [], "2026-01-10");
  assert.equal(r.tier, "red");
});

test("readiness: missing inputs are named and confidence drops", () => {
  const r = computeReadiness([obs("steps", 9000, "2026-01-10")], [], [], "2026-01-10");
  assert.equal(r.confidence, "low");
  assert.ok(r.missingInputs.includes("hrv"));
  assert.ok(r.missingInputs.includes("sleep"));
});

test("readiness: stage-1 injury caps its patterns red, others untouched", () => {
  const injury: InjuryRecord = {
    id: "i1", bodyArea: "lower back", side: "na", onsetDate: "2026-01-09",
    onsetDescription: "during lifting", pain0to10: 6, worseWith: "hinge", betterWith: "walking",
    affectedPatterns: ["hinge"], status: "active", stage: 1, redFlags: [],
    professionalNotes: null,
    provenance: { source: "in-app-log", recordedAt: "2026-01-09", enteredAt: ENTERED },
  };
  const observations = [...baselineDays("2026-01-10", 28, goodDay), ...goodDay("2026-01-10")];
  const r = computeReadiness(observations, [], [injury], "2026-01-10");
  assert.equal(r.tier, "green");
  assert.equal(r.perPattern.hinge, "red");
  assert.equal(r.perPattern.squat, undefined);
});

const goal = (type: Goal["type"], weight: number, extra: Partial<Goal> = {}): Goal => ({
  id: `g-${type}`, type, target: null, targetUnit: null, deadline: null, weight, active: true, ...extra,
});

test("goal weights normalize and drive candidate scoring", () => {
  const goals = normalizeGoals([goal("fat-loss", 50), goal("muscle", 30), goal("sleep", 20)]);
  assert.ok(Math.abs(goals[0].normalizedWeight - 0.5) < 1e-9);
  const runScore = scoreCandidate({ id: "run", relevance: { "fat-loss": 0.9 } }, goals);
  const liftScore = scoreCandidate({ id: "lift", relevance: { muscle: 0.9 } }, goals);
  assert.ok(runScore > liftScore);
});

test("fat loss + muscle both weighted resolves to recomp, openly", () => {
  const goals = normalizeGoals([goal("fat-loss", 50), goal("muscle", 30), goal("sleep", 20)]);
  const r = resolveEnergyMode(goals);
  assert.equal(r.mode, "recomp");
  assert.match(r.explanation, /pull against each other/);
});

test("pace: a deadline requiring more than the safe bound is flagged at risk", () => {
  const r = trackPace({
    goal: goal("fat-loss", 50, { target: 80, deadline: "2026-02-08" }),
    startValue: 100, currentValue: 99, startDate: "2026-01-01", asOf: "2026-01-10",
    safeMaxRatePerWeek: 1.0,
  });
  assert.equal(r.deadlineAtRisk, true);
  assert.equal(r.appliedRatePerWeek, 1.0);
});

test("expenditure estimate uses intake plus weight trend", () => {
  const observations = [obs("weight-kg", 100, "2026-01-01"), obs("weight-kg", 99, "2026-01-15")];
  const nutrition = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-01-${String(2 + i).padStart(2, "0")}`,
    kcal: 2000, proteinG: null, carbsNetG: null, fatG: null, fiberG: null,
    sodiumMg: null, potassiumMg: null, magnesiumMg: null, calciumMg: null,
    vitaminDIu: null, omega3G: null,
    provenance: { source: "cronometer-csv" as const, recordedAt: "2026-01-02", enteredAt: ENTERED },
  }));
  const est = estimateExpenditure(observations, nutrition);
  // 2000 intake + (1 kg over 14 days * 7700 / 14) = 2000 + 550 = 2550
  assert.equal(est.kcalPerDay, 2550);
});

test("nutrition targets: protein first, deficit second, carbs last", () => {
  const goals = normalizeGoals([goal("fat-loss", 50), goal("muscle", 30), goal("sleep", 20)]);
  const t = computeNutritionTargets({ goals, bodyWeightKg: 100, expenditureKcal: 2500, fastingToday: false });
  assert.equal(t.mode, "fed");
  assert.equal(t.kcal, 2200); // recomp: 2500 - 300
  assert.ok(t.proteinG !== null && t.proteinG >= 170 && t.proteinG <= 195);
  assert.equal(t.carbsNetG, 40); // fat-loss dominant: keto range
  assert.ok(t.fatG !== null && t.fatG > 0);
});

test("nutrition targets: fasting day switches to electrolyte mode", () => {
  const goals = normalizeGoals([goal("fat-loss", 50)]);
  const t = computeNutritionTargets({ goals, bodyWeightKg: 100, expenditureKcal: 2500, fastingToday: true });
  assert.equal(t.mode, "fasting");
  assert.equal(t.kcal, null);
  assert.deepEqual(t.micros.sodiumMg, [3000, 5000]);
});

function emptyInputs(overrides: Partial<EngineInputs> = {}): EngineInputs {
  return {
    observations: [], bloodPressure: [], workouts: [], nutrition: [], fasts: [],
    checkIns: [], injuries: [], goals: [], equipment: [], ...overrides,
  };
}

test("planner: fasting day allows walking and mobility only", () => {
  const goals = normalizeGoals([goal("fat-loss", 50), goal("muscle", 50)]);
  const inputs = emptyInputs({
    observations: [...baselineDays("2026-01-12", 28, goodDay), ...goodDay("2026-01-12")],
    fasts: [{ startedAt: "2026-01-12T00:00:00Z", endedAt: "2026-01-12T23:59:00Z", provenance: { source: "in-app-log", recordedAt: "2026-01-12", enteredAt: ENTERED } }],
  });
  const { sessions } = planWeek(inputs, goals, "2026-01-12");
  const monday = sessions.find((s) => s.date === "2026-01-12");
  assert.ok(monday);
  assert.ok(["walk", "mobility-flow"].includes(monday.kind));
});

test("planner: hinge injury removes the hinge/core session from a green day", () => {
  const goals = normalizeGoals([goal("lower-back", 60), goal("fat-loss", 40)]);
  const injury: InjuryRecord = {
    id: "i1", bodyArea: "lower back", side: "na", onsetDate: "2026-01-09",
    onsetDescription: "during lifting", pain0to10: 6, worseWith: "hinge", betterWith: "walking",
    affectedPatterns: ["hinge", "core-stability", "carry"], status: "active", stage: 1, redFlags: [],
    professionalNotes: null,
    provenance: { source: "in-app-log", recordedAt: "2026-01-09", enteredAt: ENTERED },
  };
  const inputs = emptyInputs({
    observations: [...baselineDays("2026-01-12", 28, goodDay), ...goodDay("2026-01-12")],
    injuries: [injury],
  });
  const { sessions } = planWeek(inputs, goals, "2026-01-12");
  const monday = sessions.find((s) => s.date === "2026-01-12");
  assert.ok(monday);
  assert.notEqual(monday.kind, "strength-hinge-core");
});

test("planner: back stiffness 7 in today's check-in removes hinge work and says why", () => {
  const goals = normalizeGoals([goal("lower-back", 60), goal("fat-loss", 40)]);
  const inputs = emptyInputs({
    observations: [...baselineDays("2026-01-12", 28, goodDay), ...goodDay("2026-01-12")],
    checkIns: [{
      date: "2026-01-12", soreness: null, backStiffness: 7, mood: null, sessionRpe: null,
      note: null, provenance: { source: "in-app-log", recordedAt: "2026-01-12", enteredAt: ENTERED },
    }],
  });
  const { sessions } = planWeek(inputs, goals, "2026-01-12");
  const monday = sessions.find((s) => s.date === "2026-01-12");
  assert.ok(monday);
  assert.notEqual(monday.kind, "strength-hinge-core");
  assert.ok(monday.reasons.some((r) => r.includes("Back stiffness 7/10")));
});

test("readiness: red-flag symptoms cap affected patterns red regardless of stage", () => {
  const injury: InjuryRecord = {
    id: "i2", bodyArea: "lower back", side: "na", onsetDate: "2026-01-09",
    onsetDescription: "crept up", pain0to10: 5, worseWith: "sitting", betterWith: "walking",
    affectedPatterns: ["hinge"], status: "recovering", stage: 3, redFlags: ["radiating pain"],
    professionalNotes: null,
    provenance: { source: "in-app-log", recordedAt: "2026-01-09", enteredAt: ENTERED },
  };
  const observations = [...baselineDays("2026-01-10", 28, goodDay), ...goodDay("2026-01-10")];
  const r = computeReadiness(observations, [], [injury], "2026-01-10");
  assert.equal(r.perPattern.hinge, "red");
});

test("coaching voice: statements are observation/benchmark/labeled opinion only", () => {
  const text = formatStatement({
    observation: "HRV 36 ms against a 7-day average of 47 ms.",
    benchmark: "ACSM floor is 150 min/week moderate aerobic.",
    opinion: "the run should move to tomorrow.",
  });
  assert.match(text, /Opinion: the run should move/);
  assertCoachingVoice(text);
  assert.throws(() => assertCoachingVoice("Great job, keep it up!"));
});
