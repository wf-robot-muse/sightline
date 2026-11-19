// Garmin Personal API adapter.
//
// Input contract: the per-day bundle produced by the Garmin helper
// (garmin_api.py day YYYY-MM-DD):
//   { date, results: { heart_rate: {status, data}, hrv: {...},
//     sleep: {...}, body_battery: {...}, spo2: {...},
//     daily_summary: {...} } }
//
// Contract rules (spec §3): a vendor format change fails loudly at
// import time. If the bundle is malformed, or every section failed,
// this throws AdapterError. Individual null vendor values are
// skipped — the app never fills gaps with invented values (§3).

import type { Observation } from "../model.ts";
import { METRIC_RANGES, requireDate, requireRange } from "../validate.ts";

export class AdapterError extends Error {}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const HRV_STATUS_CODE: Record<string, number> = {
  BALANCED: 3,
  UNBALANCED: 2,
  LOW: 1,
  POOR: 0,
};

export function garminDayBundleToObservations(bundle: unknown, enteredAt: string): Observation[] {
  if (!isObj(bundle) || !isObj(bundle.results) || typeof bundle.date !== "string") {
    throw new AdapterError("garmin bundle: expected {date, results{...}} shape");
  }
  const date = requireDate(bundle.date, "garmin.date");
  const results = bundle.results;
  const sections = ["heart_rate", "hrv", "sleep", "body_battery", "spo2", "daily_summary"];
  let okSections = 0;
  const data: Record<string, Json> = {};
  for (const name of sections) {
    const section = results[name];
    // body_battery data is an array of day objects; the rest are objects.
    if (isObj(section) && section.status === 200 && (isObj(section.data) || Array.isArray(section.data))) {
      okSections += 1;
      data[name] = section.data as Json;
    }
  }
  if (okSections === 0) {
    throw new AdapterError(
      "garmin bundle: every section missing or failed — possible auth failure or format change",
    );
  }

  const out: Observation[] = [];
  const push = (metric: Observation["metric"], value: number | null) => {
    if (value === null) return;
    const range = METRIC_RANGES[metric];
    out.push({
      metric,
      value: requireRange(value, `garmin.${metric}`, range[0], range[1]),
      date,
      provenance: { source: "garmin", recordedAt: date, enteredAt },
    });
  };

  const summary = data.daily_summary ?? {};
  push("steps", num(summary.totalSteps));
  push("resting-hr-bpm", num(summary.restingHeartRate));
  push("total-kcal", num(summary.totalKilocalories));
  push("active-kcal", num(summary.activeKilocalories));
  push("stress-avg", num(summary.averageStressLevel));
  push("respiration-brpm", num(summary.avgWakingRespirationValue));

  if (data.heart_rate && num(summary.restingHeartRate) === null) {
    push("resting-hr-bpm", num(data.heart_rate.restingHeartRate));
  }

  const hrvSummary = isObj(data.hrv?.hrvSummary) ? data.hrv.hrvSummary : null;
  if (hrvSummary) {
    push("hrv-ms", num(hrvSummary.lastNightAvg));
    const status = typeof hrvSummary.status === "string" ? HRV_STATUS_CODE[hrvSummary.status] : undefined;
    push("hrv-status", status ?? null);
  }

  // Sleep fields live at the top level of the dailySleep payload;
  // some payload variants nest them under dailySleepDTO. Accept both
  // (verified against real payloads in the Phase 1 backtest).
  const sleepRaw = data.sleep ?? null;
  const sleepDto = sleepRaw
    ? isObj(sleepRaw.dailySleepDTO)
      ? sleepRaw.dailySleepDTO
      : sleepRaw
    : null;
  if (sleepDto) {
    const seconds = num(sleepDto.sleepTimeSeconds);
    push("sleep-duration-min", seconds === null ? null : Math.round(seconds / 60));
    const scores = isObj(sleepDto.sleepScores) ? sleepDto.sleepScores : null;
    const overall = scores && isObj(scores.overall) ? scores.overall : null;
    push("sleep-score", overall ? num(overall.value) : null);
    push("respiration-brpm", num(sleepDto.averageRespirationValue));
    const need = isObj(sleepDto.sleepNeed) ? sleepDto.sleepNeed : null;
    push("sleep-need-min", need ? num(need.actual) : null);
  }

  const bb = data.body_battery;
  if (bb) {
    const days = Array.isArray(bb) ? bb : [bb];
    for (const day of days) {
      if (!isObj(day)) continue;
      const values = day.bodyBatteryValuesArray;
      if (Array.isArray(values)) {
        const levels = values
          .map((pair) => (Array.isArray(pair) ? num(pair[1]) : null))
          .filter((v): v is number => v !== null);
        if (levels.length > 0) {
          push("body-battery-peak", Math.max(...levels));
          push("body-battery-low", Math.min(...levels));
        }
      }
    }
  }

  if (data.spo2) {
    push("spo2-pct", num(data.spo2.averageSpO2));
  }

  return out;
}
