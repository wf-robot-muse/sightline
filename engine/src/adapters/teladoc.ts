// Teladoc PDF adapter.
//
// No Teladoc API exists (spec §3). The import route is the portal's
// 30/90-day Health Summary Report PDF, parsed by the Phase 0 harness
// into a structured extraction:
//   { report_date, most_recent_weight: {value_lb, when},
//     bp_average: {systolic, diastolic, hr_bpm},
//     bp_logs_detail: [{date, time, systolic, diastolic,
//                       heart_rate_bpm, source}] }
//
// Phase 0 result (Nov 18, 2026, recorded in the goal notes): the PDF
// has no weight log table — the full weight series is chart-only and
// cannot be extracted. This adapter therefore supplies BP log rows
// and the most-recent weight only. It never invents a weight series.

import type { BloodPressureReading, Observation } from "../model.ts";
import { AdapterError } from "./garmin.ts";
import { requireDate, requireRange } from "../validate.ts";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LB_TO_KG = 0.45359237;

export interface TeladocImport {
  observations: Observation[];
  bloodPressure: BloodPressureReading[];
}

export function teladocExtractionToCanonical(extraction: unknown, enteredAt: string): TeladocImport {
  if (!isObj(extraction)) {
    throw new AdapterError("teladoc extraction: expected an object");
  }
  const observations: Observation[] = [];
  const bloodPressure: BloodPressureReading[] = [];

  const mrw = extraction.most_recent_weight;
  if (isObj(mrw) && typeof mrw.value_lb === "number" && typeof mrw.when === "string") {
    const datePart = mrw.when.slice(0, 10);
    const date = requireDate(datePart, "teladoc.most_recent_weight.when");
    observations.push({
      metric: "weight-kg",
      value: requireRange(mrw.value_lb * LB_TO_KG, "teladoc.weight", 25, 500),
      date,
      provenance: { source: "teladoc-pdf", recordedAt: date, enteredAt },
    });
  }

  const rows = extraction.bp_logs_detail;
  if (rows !== undefined && !Array.isArray(rows)) {
    throw new AdapterError("teladoc extraction: bp_logs_detail must be an array");
  }
  for (const row of (rows as unknown[]) ?? []) {
    if (!isObj(row)) throw new AdapterError("teladoc extraction: BP log row is not an object");
    const date = requireDate(row.date, "teladoc.bp.date");
    bloodPressure.push({
      systolic: requireRange(row.systolic, "teladoc.bp.systolic", 50, 300),
      diastolic: requireRange(row.diastolic, "teladoc.bp.diastolic", 30, 200),
      pulseBpm:
        typeof row.heart_rate_bpm === "number"
          ? requireRange(row.heart_rate_bpm, "teladoc.bp.pulse", 25, 230)
          : null,
      date,
      provenance: { source: "teladoc-pdf", recordedAt: date, enteredAt },
    });
  }

  if (observations.length === 0 && bloodPressure.length === 0) {
    throw new AdapterError(
      "teladoc extraction: no weight and no BP rows found — possible PDF format change",
    );
  }
  return { observations, bloodPressure };
}
