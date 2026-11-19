import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionToWorkout,
  workoutCard,
  encodeWorkoutFit,
  fitCrc16,
  assessStage,
  preventionAllocations,
  findRecurrence,
  validatePainReport,
  scoreNutritionDay,
  scoreNutritionWeek,
  computeNutritionTargets,
  normalizeGoals,
  type InjuryRecord,
  type NutritionDay,
  type PainReport,
  type PlannedSession,
} from "../src/index.ts";

const session = (kind: PlannedSession["kind"], durationMin = 30): PlannedSession => ({
  date: "2026-11-19",
  kind,
  durationMin,
  gatedBy: "green",
  reasons: [],
});

// Minimal FIT decoder for round-trip verification.
interface DecodedMsg { global: number; values: (number | string)[] }
function decodeFit(bytes: Uint8Array): DecodedMsg[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hsize = bytes[0]!;
  const dsize = view.getUint32(4, true);
  assert.equal(bytes[hsize + dsize]! | (bytes[hsize + dsize + 1]! << 8), fitCrc16(bytes, 0, hsize + dsize), "CRC valid");
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), ".FIT");
  const msgs: DecodedMsg[] = [];
  const defs = new Map<number, { global: number; fields: [number, number, number][] }>();
  let pos = hsize;
  const end = hsize + dsize;
  while (pos < end) {
    const hdr = bytes[pos++]!;
    const local = hdr & 0x0f;
    if (hdr & 0x40) {
      const global = view.getUint16(pos + 2, true);
      const n = bytes[pos + 4]!;
      pos += 5;
      const fields: [number, number, number][] = [];
      for (let i = 0; i < n; i++) { fields.push([bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!]); pos += 3; }
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local)!;
      const values: (number | string)[] = [];
      for (const [, size, type] of def.fields) {
        if (type === 0x07) {
          values.push(new TextDecoder().decode(bytes.slice(pos, pos + size)).replace(/\0+$/, ""));
        } else if (size === 1) values.push(bytes[pos]!);
        else if (size === 2) values.push(view.getUint16(pos, true));
        else if (size === 4) values.push(view.getUint32(pos, true));
        pos += size;
      }
      msgs.push({ global: def.global, values });
    }
  }
  return msgs;
}

test("run-easy converts to a 3-step Zone 2 workout and encodes to valid FIT", () => {
  const w = sessionToWorkout(session("run-easy"))!;
  assert.equal(w.steps.length, 3);
  assert.match(w.name, /\[SL-2026-11-19-run-easy\]/);
  const fit = encodeWorkoutFit(w, { createdAt: new Date("2026-11-19T12:00:00Z") });
  const msgs = decodeFit(fit);
  const workout = msgs.find((m) => m.global === 26)!;
  assert.ok(workout.values.includes(w.name));
  const steps = msgs.filter((m) => m.global === 27);
  assert.equal(steps.length, 3);
  const main = steps[1]!;
  assert.equal(main.values[1], 1); // duration_type distance
  assert.equal(main.values[2], 320000); // 3200 m in cm
  assert.equal(main.values[4], 2); // HR zone 2
});

test("run-hard encodes a repeat step; strength encodes exercise titles", () => {
  const hard = sessionToWorkout(session("run-hard"))!;
  const msgs = decodeFit(encodeWorkoutFit(hard));
  const steps = msgs.filter((m) => m.global === 27);
  assert.equal(steps.length, 5); // warmup, interval, rest, repeat, cooldown
  const repeat = steps[3]!;
  assert.equal(repeat.values[1], 6); // repeat_until_steps_cmplt
  assert.equal(repeat.values[2], 2); // repeat last 2 steps
  assert.equal(repeat.values[4], 3); // 3 more times

  const strength = sessionToWorkout(session("strength-hinge-core"))!;
  const smsgs = decodeFit(encodeWorkoutFit(strength));
  const titles = smsgs.filter((m) => m.global === 264);
  assert.ok(titles.length > 0, "exercise_title messages present");
  assert.ok(titles.some((t) => t.values.includes("Dead Bug")));
  const card = workoutCard(strength);
  assert.match(card, /Dead Bug/);
});

test("practice sessions are not workouts", () => {
  assert.equal(sessionToWorkout(session("sleep-practice")), null);
  assert.equal(sessionToWorkout(session("recovery")), null);
});

const injury = (over: Partial<InjuryRecord> = {}): InjuryRecord => ({
  id: "inj-1",
  bodyArea: "lower back",
  side: "na",
  onsetDate: "2026-11-01",
  onsetDescription: "deadlift",
  pain0to10: 4,
  worseWith: "",
  betterWith: "",
  affectedPatterns: ["hinge", "core-stability"],
  stage: 1,
  redFlags: [],
  status: "active",
  professionalNotes: null,
  provenance: { source: "manual", recordedAt: "2026-11-01T00:00:00Z" },
  ...over,
});
const report = (date: string, during: number, morning: number): PainReport => ({
  injuryId: "inj-1", date, painDuring: during, painNextMorning: morning,
});

test("stage assessment: advance on two calm reports, step back on a flare, hold otherwise", () => {
  const adv = assessStage(injury(), [report("2026-11-10", 2, 2), report("2026-11-12", 1, 1)]);
  assert.equal(adv.action, "advance");
  assert.equal(adv.toStage, 2);
  const back = assessStage(injury({ stage: 2 }), [report("2026-11-10", 6, 7)]);
  assert.equal(back.action, "step-back");
  assert.equal(back.toStage, 1);
  const hold = assessStage(injury(), [report("2026-11-10", 3, 3)]);
  assert.equal(hold.action, "hold");
  assert.throws(() => validatePainReport(report("2026-11-10", 11, 0)));
});

test("prevention allocations and recurrence use resolved injuries", () => {
  const resolved = injury({ status: "resolved" });
  const items = preventionAllocations([resolved]);
  assert.equal(items.length, 2); // hinge + core-stability
  assert.equal(preventionAllocations([injury()]).length, 0);
  assert.equal(findRecurrence([resolved], "Lower Back")?.id, "inj-1");
  assert.equal(findRecurrence([resolved], "knee"), null);
});

const targets = computeNutritionTargets({
  goals: normalizeGoals([
    { id: "g1", type: "fat-loss", weight: 50, deadline: null, active: true },
    { id: "g2", type: "muscle", weight: 50, deadline: null, active: true },
  ]),
  bodyWeightKg: 90,
  expenditureKcal: 2600,
  fastingToday: false,
});
const day = (over: Partial<NutritionDay> = {}): NutritionDay => ({
  date: "2026-11-19",
  kcal: targets.kcal,
  proteinG: targets.proteinG,
  carbsNetG: 30,
  fatG: targets.fatG,
  fiberG: 27,
  sodiumMg: 4000,
  potassiumMg: 4000,
  magnesiumMg: 500,
  calciumMg: 1100,
  vitaminDIu: 1000,
  omega3G: 2,
  provenance: { source: "cronometer-csv", recordedAt: "2026-11-19T00:00:00Z" },
  ...over,
});

test("nutrition scoring: on-target day scores met; missing nutrient is not-logged, never zero", () => {
  const scores = scoreNutritionDay(day(), targets);
  assert.ok(scores.every((s) => s.status === "met"), JSON.stringify(scores.filter((s) => s.status !== "met")));
  const partial = scoreNutritionDay(day({ proteinG: null, vitaminDIu: null }), targets);
  assert.equal(partial.find((s) => s.nutrient === "Protein")?.status, "not-logged");
  assert.equal(partial.find((s) => s.nutrient === "Vitamin D")?.status, "not-logged");
  const lowProtein = scoreNutritionDay(day({ proteinG: (targets.proteinG ?? 100) - 60 }), targets);
  assert.equal(lowProtein.find((s) => s.nutrient === "Protein")?.status, "low");
  const week = scoreNutritionWeek([day(), day({ proteinG: 10 })], targets);
  assert.equal(week.loggedDays, 2);
  assert.equal(week.byNutrient.find((n) => n.nutrient === "Protein")?.low, 1);
});
