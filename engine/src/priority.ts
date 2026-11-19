// Source priority and conflict handling (spec v1.0 §3).
//
// When two sources report the same metric for the same date, both
// values are kept in storage; the engine reads the one from the
// highest-priority source for that metric, and the choice is visible
// (the returned record carries its provenance). Priorities are
// declared per metric, not globally: Garmin is the step source of
// record (Wade's direction, Nov 18, 2026) while Apple Health steps
// remain a secondary series that is never mixed into it.

import type { MetricKind, Observation, SourceId } from "./model.ts";

const PRIORITY: Partial<Record<MetricKind, SourceId[]>> = {
  steps: ["garmin", "apple-health", "manual"],
  "resting-hr-bpm": ["garmin", "apple-health", "manual"],
  "sleep-duration-min": ["garmin", "apple-health", "manual"],
  "sleep-score": ["garmin", "apple-health", "manual"],
  "weight-kg": ["teladoc-pdf", "manual"],
};

const DEFAULT_PRIORITY: SourceId[] = [
  "garmin",
  "apple-health",
  "teladoc-pdf",
  "cronometer-csv",
  "in-app-log",
  "manual",
];

export function sourcePriority(metric: MetricKind): SourceId[] {
  return PRIORITY[metric] ?? DEFAULT_PRIORITY;
}

/** Pick the winning observation per (metric, date) by source priority.
 *  Ties (same source twice) resolve to the most recently entered. */
export function resolveObservations(observations: Observation[]): Observation[] {
  const byKey = new Map<string, Observation>();
  for (const obs of observations) {
    const key = `${obs.metric}|${obs.date}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, obs);
      continue;
    }
    const order = sourcePriority(obs.metric);
    const rank = (s: SourceId) => {
      const i = order.indexOf(s);
      return i === -1 ? order.length : i;
    };
    const rNew = rank(obs.provenance.source);
    const rOld = rank(existing.provenance.source);
    if (rNew < rOld || (rNew === rOld && obs.provenance.enteredAt > existing.provenance.enteredAt)) {
      byKey.set(key, obs);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.date === b.date ? a.metric.localeCompare(b.metric) : a.date.localeCompare(b.date),
  );
}

/** Daily series for one metric from already-resolved observations. */
export function dailySeries(
  resolved: Observation[],
  metric: MetricKind,
): { date: string; value: number }[] {
  return resolved
    .filter((o) => o.metric === metric)
    .map((o) => ({ date: o.date, value: o.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
