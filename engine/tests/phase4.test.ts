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
