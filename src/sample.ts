// Clearly-labeled SAMPLE data (spec §2.1: the app may ship with
// sample entries that are deletable and are never treated as the
// user's data). Everything generated here carries ids starting with
// "sample-" and source "manual", and the UI labels it as sample data
// wherever it appears. Values are synthetic.

import type { AppStore } from "./store.ts";
import { emptyStore, todayLocal } from "./store.ts";
import type { Observation } from "../engine/src/index.ts";

function daysAgo(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function sampleStore(): AppStore {
  const store = emptyStore();
  const today = todayLocal();
  const enteredAt = new Date().toISOString();
  const mk = (metric: Observation["metric"], value: number, date: string): Observation => ({
    metric,
    value,
    date,
    provenance: { source: "manual", recordedAt: date, enteredAt },
  });

  // 28 days of synthetic readiness inputs with a realistic pattern:
  // short sleep most nights, one good night in three.
  for (let i = 28; i >= 0; i--) {
    const date = daysAgo(today, i);
    const goodNight = i % 3 === 0;
    store.observations.push(
      mk("hrv-ms", goodNight ? 52 : 41 + (i % 4), date),
      mk("sleep-duration-min", goodNight ? 470 : 375 + (i % 5) * 8, date),
      mk("sleep-score", goodNight ? 76 : 55 + (i % 6), date),
      mk("sleep-need-min", 510, date),
      mk("body-battery-peak", goodNight ? 68 : 44 + (i % 5) * 3, date),
      mk("resting-hr-bpm", goodNight ? 53 : 56, date),
      mk("steps", 8200 + (i % 7) * 350, date),
      mk("weight-kg", 96 - (28 - i) * 0.05, date),
    );
  }

  store.goals = [
    { id: "sample-goal-fat", type: "fat-loss", target: null, targetUnit: null, deadline: null, weight: 50, active: true },
    { id: "sample-goal-muscle", type: "muscle", target: null, targetUnit: null, deadline: null, weight: 30, active: true },
    { id: "sample-goal-sleep", type: "sleep", target: null, targetUnit: null, deadline: null, weight: 20, active: true },
  ];
  store.equipment = [
    { id: "sample-eq-1", name: "SAMPLE: dumbbells", provenance: { source: "manual", recordedAt: today, enteredAt } },
    { id: "sample-eq-2", name: "SAMPLE: resistance bands", provenance: { source: "manual", recordedAt: today, enteredAt } },
  ];
  return store;
}

export function isSampleId(id: string): boolean {
  return id.startsWith("sample-");
}
