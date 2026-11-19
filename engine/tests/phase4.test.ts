import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shadowWeek,
  normalizeGoals,
  type EngineInputs,
  type WorkoutRecord,
} from "../src/index.ts";

const goals = normalizeGoals([
  { id: "g1", type: "fat-loss", weight: 50, deadline: null, active: true },
  { id: "g2", type: "muscle", weight: 50, deadline: null, active: true },
]);

const workout = (date: string, kind: WorkoutRecord["kind"]): WorkoutRecord => ({
  id: `w-${date}-${kind}`,
  kind,
  startAt: `${date}T07:00:00Z`,
  durationMin: 30,
  distanceKm: null,
  load: 30,
  provenance: { source: "manual", recordedAt: date },
});

function inputs(workouts: WorkoutRecord[]): EngineInputs {
  return {
    observations: [], bloodPressure: [], workouts, nutrition: [],
    fasts: [], checkIns: [], injuries: [], goals: [], equipment: [],
  };
}

test("shadow week classifies followed, substituted, missed, extra, upcoming", () => {
  const weekStart = "2026-11-16"; // Monday
  // Discover what the planner puts on Mon/Tue from an empty log, then
  // script actuals against it.
  const probe = shadowWeek(inputs([]), goals, weekStart, "2026-11-22");
  const plannedDays = probe.days.filter((d) => d.planned && d.planned.kind !== "recovery" && d.planned.kind !== "sleep-practice");
  assert.ok(plannedDays.length >= 2, "planner produced sessions to shadow");

  const first = plannedDays[0]!;
  const second = plannedDays[1]!;
  const groupOf = (kind: string) =>
    kind.startsWith("run") ? "run" : kind.startsWith("strength") ? "strength" : kind === "walk" ? "walk" : "mobility";
  const actuals = [
    workout(first.date, groupOf(first.planned!.kind) as WorkoutRecord["kind"]), // followed
    workout(second.date, "ride"), // substituted (different kind)
    workout("2026-11-22", "run"), // Sunday: extra if nothing planned, else followed/substituted
  ];
  const report = shadowWeek(inputs(actuals), goals, weekStart, "2026-11-22");
  const byDate = new Map(report.days.map((d) => [d.date, d]));
  assert.equal(byDate.get(first.date)?.outcome, "followed");
  assert.equal(byDate.get(second.date)?.outcome, "substituted");
  const decided = report.counts.followed + report.counts.substituted + report.counts.missed;
  assert.ok(decided >= 2);
  assert.ok(report.lines.some((l) => l.includes("followed")));

  const future = shadowWeek(inputs([]), goals, weekStart, "2026-11-16");
  assert.equal(future.counts.upcoming, 6); // Tue–Sun not yet decided
});

test("shadow week reports training on red days as a tuning question, not a grade", () => {
  const report = shadowWeek(inputs([workout("2026-11-16", "run")]), goals, "2026-11-16", "2026-11-22");
  assert.ok(report.lines.some((l) => l.includes("red readiness tier")));
});

test("units: workout card renders imperial distances and paces only on request", async () => {
  const { workoutCard, fmtWeight, weightToKg } = await import("../src/index.ts");
  const run = {
    id: "w-units",
    name: "Easy Run",
    sport: "running" as const,
    repeats: [],
    steps: [{
      name: "Run",
      kind: "active" as const,
      durationSec: null,
      distanceM: 5000,
      reps: null,
      target: { type: "pace" as const, secPerKm: 300 },
      exerciseName: null,
    }],
  };
  const metric = workoutCard(run, "metric");
  assert.match(metric, /5\.00 km/);
  assert.match(metric, /5:00\/km/);
  const imperial = workoutCard(run, "imperial");
  assert.match(imperial, /3\.11 mi/);
  assert.match(imperial, /8:03\/mi/);
  // Default stays metric so stored text and older callers are unchanged.
  assert.equal(workoutCard(run), metric);
  assert.equal(fmtWeight(95.8, "imperial"), "211.2 lb");
  assert.equal(fmtWeight(95.8, "metric"), "95.8 kg");
  assert.ok(Math.abs(weightToKg(211.2, "imperial") - 95.8) < 0.05);
  assert.equal(weightToKg(95.8, "metric"), 95.8);
});

test("units: expenditure detail reports weight change in the caller's units", async () => {
  const { estimateExpenditure } = await import("../src/index.ts");
  const prov = { source: "manual" as const, recordedAt: "2026-01-01T00:00:00Z", enteredAt: "2026-01-01T00:00:00Z" };
  const observations = [
    { metric: "weight-kg" as const, value: 100, date: "2026-01-01", provenance: prov },
    { metric: "weight-kg" as const, value: 99, date: "2026-01-15", provenance: prov },
  ];
  const nutrition = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-01-${String(2 + i).padStart(2, "0")}`,
    kcal: 2000, proteinG: null, carbsNetG: null, fatG: null, fiberG: null,
    sodiumMg: null, potassiumMg: null, magnesiumMg: null, calciumMg: null,
    vitaminDIu: null, omega3G: null,
    provenance: { source: "cronometer-csv" as const, recordedAt: "2026-01-02T00:00:00Z", enteredAt: "2026-01-02T00:00:00Z" },
  }));
  assert.match(estimateExpenditure(observations, nutrition, "metric").detail, /-1\.0 kg/);
  assert.match(estimateExpenditure(observations, nutrition, "imperial").detail, /-2\.2 lb/);
});
