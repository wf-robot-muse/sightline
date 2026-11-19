import assert from "node:assert/strict";
import { test } from "node:test";
import { AdapterError, garminDayBundleToObservations } from "../src/adapters/garmin.ts";
import { teladocExtractionToCanonical } from "../src/adapters/teladoc.ts";
import { cronometerCsvToNutritionDays } from "../src/adapters/cronometer.ts";
import { manualObservations } from "../src/adapters/manual.ts";
import { ENTERED, garminBundle } from "./fixtures.ts";

test("garmin bundle translates to canonical observations", () => {
  const out = garminDayBundleToObservations(garminBundle("2026-01-10"), ENTERED);
  const byMetric = new Map(out.map((o) => [o.metric, o.value]));
  assert.equal(byMetric.get("steps"), 9000);
  assert.equal(byMetric.get("hrv-ms"), 40);
  assert.equal(byMetric.get("hrv-status"), 2); // UNBALANCED
  assert.equal(byMetric.get("sleep-duration-min"), 420);
  assert.equal(byMetric.get("sleep-score"), 62);
  assert.equal(byMetric.get("body-battery-peak"), 55);
  assert.equal(byMetric.get("body-battery-low"), 20);
  assert.equal(byMetric.get("spo2-pct"), 97);
  assert.ok(out.every((o) => o.provenance.source === "garmin"));
});

test("garmin bundle accepts the real top-level sleep shape and reads sleep need", () => {
  const bundle = garminBundle("2026-01-10", {
    sleep: {
      status: 200,
      data: {
        sleepTimeSeconds: 21600,
        sleepScores: { overall: { value: 40 } },
        averageRespirationValue: 15,
        sleepNeed: { baseline: 470, actual: 530 },
      },
    },
  });
  const out = garminDayBundleToObservations(bundle, ENTERED);
  const byMetric = new Map(out.map((o) => [o.metric, o.value]));
  assert.equal(byMetric.get("sleep-duration-min"), 360);
  assert.equal(byMetric.get("sleep-score"), 40);
  assert.equal(byMetric.get("sleep-need-min"), 530);
});

test("garmin bundle with every section failed throws loudly", () => {
  const bad = {
    date: "2026-01-10",
    results: { heart_rate: { status: 401, data: null }, hrv: { status: 401, data: null } },
  };
  assert.throws(() => garminDayBundleToObservations(bad, ENTERED), AdapterError);
});

test("garmin null values are skipped, never invented", () => {
  const bundle = garminBundle("2026-01-10", { spo2: { status: 200, data: { averageSpO2: null } } });
  const out = garminDayBundleToObservations(bundle, ENTERED);
  assert.ok(!out.some((o) => o.metric === "spo2-pct"));
});

test("teladoc extraction converts weight and BP rows", () => {
  const extraction = {
    report_date: "2026-01-12",
    most_recent_weight: { value_lb: 200, when: "2026-01-10" },
    bp_logs_detail: [
      { date: "2026-01-09", time: "08:00", systolic: 120, diastolic: 80, heart_rate_bpm: 60, source: "device" },
    ],
  };
  const { observations, bloodPressure } = teladocExtractionToCanonical(extraction, ENTERED);
  assert.equal(observations.length, 1);
  assert.ok(Math.abs(observations[0].value - 90.718) < 0.01);
  assert.equal(bloodPressure.length, 1);
  assert.equal(bloodPressure[0].systolic, 120);
});

test("teladoc extraction with nothing extractable throws", () => {
  assert.throws(() => teladocExtractionToCanonical({ report_date: "2026-01-12" }, ENTERED), AdapterError);
});

const CRON_HEADER =
  "Date,Energy (kcal),Protein (g),Carbs (g),Fiber (g),Net Carbs (g),Fat (g),Sodium (mg),Potassium (mg),Magnesium (mg),Calcium (mg),Vitamin D (IU),Omega-3 (g)";

test("cronometer csv parses days and dedupes by date", () => {
  const csv = [
    CRON_HEADER,
    "2026-01-10,2100,150,60,20,40,150,3200,3600,450,1000,900,1.5",
    "2026-01-10,2100,150,60,20,40,150,3200,3600,450,1000,900,1.5",
    "2026-01-11,2200,160,70,22,48,155,3300,3700,460,1010,950,1.6",
  ].join("\n");
  const days = cronometerCsvToNutritionDays(csv, ENTERED);
  assert.equal(days.length, 2);
  assert.equal(days[0].proteinG, 150);
  assert.equal(days[0].carbsNetG, 40);
});

test("cronometer csv with a changed header fails loudly", () => {
  const csv = "Date,Energy (kcal)\n2026-01-10,2100";
  assert.throws(() => cronometerCsvToNutritionDays(csv, ENTERED), AdapterError);
});

test("manual entries are validated and carry manual provenance", () => {
  const out = manualObservations([{ metric: "weight-kg", value: 90, date: "2026-01-10" }], ENTERED);
  assert.equal(out[0].provenance.source, "manual");
  assert.throws(() =>
    manualObservations([{ metric: "weight-kg", value: 900, date: "2026-01-10" }], ENTERED),
  );
});
