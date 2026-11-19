// Input validation for everything entering the canonical model.
//
// Wade's standing rule (2026-11-12): all user input in apps Robot
// builds is untrusted — validate format and range, cap length, and
// re-validate persisted values on load. Adapters call these helpers
// on every value they translate; a value that fails validation is
// rejected with a named error, never silently coerced.

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.field = field;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new ValidationError(field, "expected a YYYY-MM-DD date string");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(field, "not a real calendar date");
  }
  return value;
}

export function requireInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 40) {
    throw new ValidationError(field, "expected an ISO 8601 instant string");
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(field, "not a parseable ISO 8601 instant");
  }
  return value;
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(field, "expected a finite number");
  }
  return value;
}

export function requireRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  const n = requireFiniteNumber(value, field);
  if (n < min || n > max) {
    throw new ValidationError(field, `value ${n} outside allowed range ${min}..${max}`);
  }
  return n;
}

export function optionalRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (value === null || value === undefined) return null;
  return requireRange(value, field, min, max);
}

/** Free text from the user: capped, control characters stripped.
 *  Callers render it as text, never as HTML (spec input rule). */
export function capText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ValidationError(field, "expected a string");
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (cleaned.length > maxLength) {
    throw new ValidationError(field, `text exceeds ${maxLength} characters`);
  }
  return cleaned;
}

export function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return capText(value, field, maxLength);
}

/** Plausible physiological ranges per metric. Values outside are
 *  rejected at the adapter boundary, not clamped: a bad reading is a
 *  data problem to surface, not a number to fix silently. */
export const METRIC_RANGES: Record<string, [number, number]> = {
  "weight-kg": [25, 500],
  "resting-hr-bpm": [25, 120],
  "hrv-ms": [1, 500],
  "hrv-status": [0, 3],
  "sleep-duration-min": [0, 1440],
  "sleep-score": [0, 100],
  "sleep-need-min": [0, 1440],
  "body-battery-peak": [0, 100],
  "body-battery-low": [0, 100],
  steps: [0, 100000],
  "spo2-pct": [50, 100],
  "stress-avg": [0, 100],
  "respiration-brpm": [2, 60],
  "active-kcal": [0, 20000],
  "total-kcal": [0, 25000],
  "bp-systolic": [50, 300],
  "bp-diastolic": [30, 200],
  "heart-rate-bpm": [25, 230],
};
