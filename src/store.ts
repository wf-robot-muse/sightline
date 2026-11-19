// Local data store for the SightLine app.
//
// Local-first (spec §11.3): all data lives on the user's machine in
// the webview's local storage. No backend, no account system.
//
// Wade's input rule (2026-11-12): persisted values are re-validated
// on load. Anything that does not match the expected shape is
// dropped and counted, never trusted silently.

import type { EngineInputs } from "../engine/src/index.ts";

export interface AppStore extends EngineInputs {
  version: 1;
}

const KEY = "sightline.store.v1";

export function emptyStore(): AppStore {
  return {
    version: 1,
    observations: [],
    bloodPressure: [],
    workouts: [],
    nutrition: [],
    fasts: [],
    checkIns: [],
    injuries: [],
    goals: [],
    equipment: [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validArray<T>(value: unknown, check: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(check);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length <= 2000;

export interface LoadResult {
  store: AppStore;
  dropped: number;
}

export function loadStore(): LoadResult {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (!raw) return { store: emptyStore(), dropped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store: emptyStore(), dropped: 1 };
  }
  if (!isRecord(parsed)) return { store: emptyStore(), dropped: 1 };

  const before = (["observations", "bloodPressure", "workouts", "nutrition", "fasts", "checkIns", "injuries", "goals", "equipment"] as const)
    .reduce((n, k) => n + (Array.isArray(parsed[k]) ? (parsed[k] as unknown[]).length : 0), 0);

  const store: AppStore = {
    version: 1,
    observations: validArray(parsed.observations, (o): o is AppStore["observations"][number] =>
      isRecord(o) && isStr(o.metric) && isNum(o.value) && isStr(o.date) && isRecord(o.provenance)),
    bloodPressure: validArray(parsed.bloodPressure, (o): o is AppStore["bloodPressure"][number] =>
      isRecord(o) && isNum(o.systolic) && isNum(o.diastolic) && isStr(o.date) && isRecord(o.provenance)),
    workouts: validArray(parsed.workouts, (o): o is AppStore["workouts"][number] =>
      isRecord(o) && isStr(o.id) && isStr(o.kind) && isStr(o.startAt) && isNum(o.durationMin) && isRecord(o.provenance)),
    nutrition: validArray(parsed.nutrition, (o): o is AppStore["nutrition"][number] =>
      isRecord(o) && isStr(o.date) && isRecord(o.provenance)),
    fasts: validArray(parsed.fasts, (o): o is AppStore["fasts"][number] =>
      isRecord(o) && isStr(o.startedAt) && (o.endedAt === null || isStr(o.endedAt)) && isRecord(o.provenance)),
    checkIns: validArray(parsed.checkIns, (o): o is AppStore["checkIns"][number] =>
      isRecord(o) && isStr(o.date) && isRecord(o.provenance)),
    injuries: validArray(parsed.injuries, (o): o is AppStore["injuries"][number] =>
      isRecord(o) && isStr(o.id) && isStr(o.bodyArea) && isNum(o.pain0to10) && Array.isArray(o.affectedPatterns) && isRecord(o.provenance)),
    goals: validArray(parsed.goals, (o): o is AppStore["goals"][number] =>
      isRecord(o) && isStr(o.id) && isStr(o.type) && isNum(o.weight) && typeof o.active === "boolean"),
    equipment: validArray(parsed.equipment, (o): o is AppStore["equipment"][number] =>
      isRecord(o) && isStr(o.id) && isStr(o.name) && isRecord(o.provenance)),
  };

  const after = (["observations", "bloodPressure", "workouts", "nutrition", "fasts", "checkIns", "injuries", "goals", "equipment"] as const)
    .reduce((n, k) => n + store[k].length, 0);
  return { store, dropped: Math.max(0, before - after) };
}

export function saveStore(store: AppStore): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
