// Manual-entry adapter (spec v1.0 §3: manual-entry parity).
//
// Manual entry is a permanent adapter, not a fallback. Every metric
// the engine consumes can be entered by hand, validated the same way
// as any imported value, and stored with source "manual".

import type { MetricKind, Observation } from "../model.ts";
import { METRIC_RANGES, requireDate, requireRange } from "../validate.ts";

export interface ManualEntry {
  metric: MetricKind;
  value: number;
  date: string;
}

export function manualObservation(entry: ManualEntry, enteredAt: string): Observation {
  const range = METRIC_RANGES[entry.metric];
  if (!range) throw new Error(`unknown metric: ${entry.metric}`);
  return {
    metric: entry.metric,
    value: requireRange(entry.value, entry.metric, range[0], range[1]),
    date: requireDate(entry.date, "date"),
    provenance: { source: "manual", recordedAt: entry.date, enteredAt },
  };
}

export function manualObservations(entries: ManualEntry[], enteredAt: string): Observation[] {
  if (entries.length > 1000) throw new Error("manual import batch exceeds 1000 entries");
  return entries.map((e) => manualObservation(e, enteredAt));
}
