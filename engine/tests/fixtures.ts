// Synthetic fixtures only. Real user health data never enters this
// repository (the design spec stays out of it for the same reason);
// the backtest against real data runs locally, outside the repo.

import type { Observation } from "../src/model.ts";

export const ENTERED = "2026-01-15T12:00:00Z";

export function obs(
  metric: Observation["metric"],
  value: number,
  date: string,
  source: Observation["provenance"]["source"] = "garmin",
): Observation {
  return { metric, value, date, provenance: { source, recordedAt: date, enteredAt: ENTERED } };
}

/** A synthetic Garmin day bundle in the helper's shape. */
export function garminBundle(date: string, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    heart_rate: { status: 200, data: { restingHeartRate: 55 } },
    hrv: { status: 200, data: { hrvSummary: { lastNightAvg: 40, status: "UNBALANCED" } } },
    sleep: {
      status: 200,
      data: {
        dailySleepDTO: {
          sleepTimeSeconds: 25200,
          sleepScores: { overall: { value: 62 } },
          averageRespirationValue: 14,
        },
      },
    },
    body_battery: {
      status: 200,
      data: [{ bodyBatteryValuesArray: [[1, 20], [2, 55], [3, 30]] }],
    },
    spo2: { status: 200, data: { averageSpO2: 97 } },
    daily_summary: {
      status: 200,
      data: {
        totalSteps: 9000,
        restingHeartRate: 55,
        totalKilocalories: 2400,
        activeKilocalories: 500,
        averageStressLevel: 35,
        avgWakingRespirationValue: 14,
      },
    },
  };
  return { date, results: { ...base, ...overrides } };
}
