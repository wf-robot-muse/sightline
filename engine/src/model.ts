// Canonical data model (spec v1.0 §3).
//
// The engine never talks to a source. Every value the engine uses is
// expressed once, here, in the app's own terms, independent of any
// vendor. Each source is a replaceable adapter that translates into
// this model. Every stored value carries provenance: which source it
// came from, when it was recorded, and when it entered the app.
//
// Goals, deadlines, weights, equipment, and routines are runtime user
// data (spec §2.1): the types live here, instances never do.

export type SourceId =
  | "garmin"
  | "apple-health"
  | "teladoc-pdf"
  | "cronometer-csv"
  | "manual"
  | "in-app-log";

export interface Provenance {
  source: SourceId;
  /** ISO 8601 instant the value was measured/recorded at the source. */
  recordedAt: string;
  /** ISO 8601 instant the value entered the app. */
  enteredAt: string;
}

/** Scalar metrics the engine consumes as daily (or instant) values. */
export type MetricKind =
  | "weight-kg"
  | "resting-hr-bpm"
  | "hrv-ms"
  | "hrv-status"
  | "sleep-duration-min"
  | "sleep-score"
  | "sleep-need-min"
  | "body-battery-peak"
  | "body-battery-low"
  | "steps"
  | "spo2-pct"
  | "stress-avg"
  | "respiration-brpm"
  | "active-kcal"
  | "total-kcal"
  | "bp-systolic"
  | "bp-diastolic"
  | "heart-rate-bpm";

export interface Observation {
  metric: MetricKind;
  value: number;
  /** Calendar date (YYYY-MM-DD, user-local) the value belongs to. */
  date: string;
  provenance: Provenance;
}

export interface BloodPressureReading {
  systolic: number;
  diastolic: number;
  pulseBpm: number | null;
  date: string;
  provenance: Provenance;
}

export type WorkoutKind = "run" | "strength" | "ride" | "walk" | "mobility" | "other";

export interface WorkoutRecord {
  id: string;
  kind: WorkoutKind;
  /** ISO 8601 start instant. */
  startAt: string;
  durationMin: number;
  distanceKm: number | null;
  /** Session load in arbitrary units (duration x intensity), for ACWR. */
  load: number | null;
  provenance: Provenance;
}

export interface NutritionDay {
  date: string;
  kcal: number | null;
  proteinG: number | null;
  carbsNetG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  potassiumMg: number | null;
  magnesiumMg: number | null;
  calciumMg: number | null;
  vitaminDIu: number | null;
  omega3G: number | null;
  provenance: Provenance;
}

export interface FastingWindow {
  /** ISO 8601 start instant. */
  startedAt: string;
  /** ISO 8601 end instant, or null while the fast is in progress. */
  endedAt: string | null;
  provenance: Provenance;
}

export interface CheckIn {
  date: string;
  /** 0-10 scales, null when not reported. */
  soreness: number | null;
  backStiffness: number | null;
  mood: number | null;
  sessionRpe: number | null;
  /** Wade's own words, capped at entry (see validate.ts). */
  note: string | null;
  provenance: Provenance;
}

export type MovementPattern =
  | "squat"
  | "hinge"
  | "lunge"
  | "push-horizontal"
  | "push-vertical"
  | "pull"
  | "carry"
  | "run"
  | "core-stability"
  | "mobility";

export type InjuryStatus = "active" | "recovering" | "resolved";

export interface InjuryRecord {
  id: string;
  /** Wade's words: body area, e.g. "lower back", "left knee". */
  bodyArea: string;
  side: "left" | "right" | "both" | "na" ;
  /** ISO 8601 date the injury started or was first noticed. */
  onsetDate: string;
  /** Wade's words: how it started. */
  onsetDescription: string;
  pain0to10: number;
  worseWith: string;
  betterWith: string;
  affectedPatterns: MovementPattern[];
  status: InjuryStatus;
  /** 1 = settle, 2 = reload, 3 = return (spec §7.3). */
  stage: 1 | 2 | 3;
  redFlags: string[];
  /** Professional diagnosis/instructions, when Wade enters them.
   *  These outrank everything the app generates (spec §7.1). */
  professionalNotes: string | null;
  provenance: Provenance;
}

export type GoalType =
  | "fat-loss"
  | "muscle"
  | "sleep"
  | "core-strength"
  | "lower-back"
  | "flexibility-mobility"
  | "mental-health";

export interface Goal {
  id: string;
  type: GoalType;
  /** Measurable target in the goal type's own terms (runtime data). */
  target: number | null;
  targetUnit: string | null;
  /** ISO date, or null for open-ended goals. */
  deadline: string | null;
  /** Priority weight as entered; normalized across active goals. */
  weight: number;
  active: boolean;
}

export interface EquipmentItem {
  id: string;
  /** Wade's words, e.g. "dumbbells to 50 lb". */
  name: string;
  provenance: Provenance;
}

/** Everything the engine needs for one planning run, all canonical. */
export interface EngineInputs {
  observations: Observation[];
  bloodPressure: BloodPressureReading[];
  workouts: WorkoutRecord[];
  nutrition: NutritionDay[];
  fasts: FastingWindow[];
  checkIns: CheckIn[];
  injuries: InjuryRecord[];
  goals: Goal[];
  equipment: EquipmentItem[];
}
