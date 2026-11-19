// Neutral workout model + human-readable card (spec v1.0 §5).
//
// The planner's internal workout format is neutral: steps, targets,
// repeats. Exporters render it — the FIT exporter (fit.ts) first,
// the Garmin Connect converter later — and a human-readable card is
// always available for manual sessions.

import type { PlannedSession } from "./planner.ts";

export type WorkoutSport = "running" | "strength" | "walking" | "generic";

export type StepKind = "warmup" | "active" | "interval" | "rest" | "cooldown";

export type StepTarget =
  | { type: "hr-zone"; zone: number }
  | { type: "hr-range"; lowBpm: number; highBpm: number }
  | { type: "pace"; secPerKm: number }
  | { type: "none" };

export interface WorkoutStep {
  name: string;
  kind: StepKind;
  /** Exactly one end condition is set. */
  durationSec: number | null;
  distanceM: number | null;
  reps: number | null;
  target: StepTarget;
  /** For strength steps: the exercise name shown on the watch. */
  exerciseName: string | null;
}

export interface NeutralWorkout {
  /** Carried in the workout name as [SL-<id>] for by-name sync (§5). */
  id: string;
  name: string;
  sport: WorkoutSport;
  steps: WorkoutStep[];
  /** Repeat blocks: after step index `afterStep`, repeat the last
   *  `stepCount` steps `times` more times. */
  repeats: { afterStep: number; stepCount: number; times: number }[];
}

const step = (partial: Partial<WorkoutStep> & { name: string }): WorkoutStep => ({
  kind: "active",
  durationSec: null,
  distanceM: null,
  reps: null,
  target: { type: "none" },
  exerciseName: null,
  ...partial,
});

function strengthSteps(exercises: { name: string; sets: number; reps: number; secPerRep: number }[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const ex of exercises) {
    for (let s = 0; s < ex.sets; s++) {
      out.push(
        step({
          name: `${ex.name} — set ${s + 1} of ${ex.sets} × ${ex.reps}`,
          durationSec: ex.reps * ex.secPerRep,
          reps: ex.reps,
          exerciseName: ex.name,
        }),
      );
      if (s < ex.sets - 1) out.push(step({ name: "Rest", kind: "rest", durationSec: 60 }));
    }
  }
  return out;
}

/** Convert a planned session into a neutral workout. Practice-type
 *  sessions (sleep, recovery) are not workouts and return null. */
export function sessionToWorkout(session: PlannedSession): NeutralWorkout | null {
  const id = `${session.date}-${session.kind}`;
  const name = `SightLine ${session.kind} [SL-${id}]`;
  switch (session.kind) {
    case "run-easy":
      return {
        id, name, sport: "running", repeats: [],
        steps: [
          step({ name: "Warm up 5 min easy", kind: "warmup", durationSec: 300, target: { type: "hr-zone", zone: 1 } }),
          step({ name: "Run Zone 2", distanceM: 3200, target: { type: "hr-zone", zone: 2 } }),
          step({ name: "Cool down 5 min", kind: "cooldown", durationSec: 300, target: { type: "hr-zone", zone: 1 } }),
        ],
      };
    case "run-hard":
      return {
        id, name, sport: "running",
        repeats: [{ afterStep: 2, stepCount: 2, times: 3 }],
        steps: [
          step({ name: "Warm up 5 min easy", kind: "warmup", durationSec: 300, target: { type: "hr-zone", zone: 1 } }),
          step({ name: "Interval 3 min Zone 4", kind: "interval", durationSec: 180, target: { type: "hr-zone", zone: 4 } }),
          step({ name: "Recover 2 min", kind: "rest", durationSec: 120, target: { type: "hr-zone", zone: 1 } }),
          step({ name: "Cool down 5 min", kind: "cooldown", durationSec: 300, target: { type: "hr-zone", zone: 1 } }),
        ],
      };
    case "strength-hinge-core":
      return {
        id, name, sport: "strength", repeats: [],
        steps: strengthSteps([
          { name: "Dead Bug", sets: 3, reps: 10, secPerRep: 4 },
          { name: "Bird Dog", sets: 3, reps: 8, secPerRep: 4 },
          { name: "Glute Bridge", sets: 3, reps: 12, secPerRep: 3 },
          { name: "Suitcase Carry", sets: 3, reps: 1, secPerRep: 40 },
        ]),
      };
    case "strength-general":
      return {
        id, name, sport: "strength", repeats: [],
        steps: strengthSteps([
          { name: "Goblet Squat", sets: 3, reps: 8, secPerRep: 4 },
          { name: "Push-Up", sets: 3, reps: 10, secPerRep: 3 },
          { name: "One-Arm Row", sets: 3, reps: 10, secPerRep: 3 },
        ]),
      };
    case "walk":
      return {
        id, name, sport: "walking", repeats: [],
        steps: [step({ name: `Walk ${session.durationMin} min`, durationSec: session.durationMin * 60 })],
      };
    case "mobility-flow":
      return {
        id, name, sport: "generic", repeats: [],
        steps: [step({ name: `Mobility flow ${session.durationMin} min`, durationSec: session.durationMin * 60 })],
      };
    default:
      return null;
  }
}

function targetText(t: StepTarget): string {
  switch (t.type) {
    case "hr-zone": return `Zone ${t.zone}`;
    case "hr-range": return `${t.lowBpm}–${t.highBpm} bpm`;
    case "pace": return `${Math.floor(t.secPerKm / 60)}:${String(t.secPerKm % 60).padStart(2, "0")}/km`;
    case "none": return "";
  }
}

function endText(s: WorkoutStep): string {
  if (s.durationSec !== null) return `${Math.floor(s.durationSec / 60)}:${String(s.durationSec % 60).padStart(2, "0")}`;
  if (s.distanceM !== null) return `${(s.distanceM / 1000).toFixed(2)} km`;
  if (s.reps !== null) return `${s.reps} reps`;
  return "open";
}

/** The human-readable card: always produced, whatever exporter runs. */
export function workoutCard(w: NeutralWorkout): string {
  const lines = [w.name, `Sport: ${w.sport}`, ""];
  w.steps.forEach((s, i) => {
    const t = targetText(s.target);
    lines.push(`${i + 1}. ${s.name} — ${endText(s)}${t ? ` @ ${t}` : ""}`);
    const repeat = w.repeats.find((r) => r.afterStep === i);
    if (repeat) lines.push(`   (steps ${i - repeat.stepCount + 2}–${i + 1} repeat ${repeat.times} more times)`);
  });
  return lines.join("\n");
}
