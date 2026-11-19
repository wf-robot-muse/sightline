// Display units (Wade's fix, 2026-11-19).
//
// The canonical model is metric internally: adapters produce kg, m,
// and sec/km, and the FIT format is metric-native. Unit systems are
// a display and entry concern only. Values are converted at the user
// boundary (forms and rendered text) and never in storage, so
// switching systems loses no precision and changes no history.

export type UnitSystem = "imperial" | "metric";

export const KG_PER_LB = 0.45359237;
export const M_PER_MI = 1609.344;

export function kgFromLb(lb: number): number {
  return lb * KG_PER_LB;
}

export function lbFromKg(kg: number): number {
  return kg / KG_PER_LB;
}

/** "211.2 lb" in imperial, "95.8 kg" in metric. */
export function fmtWeight(kg: number, units: UnitSystem): string {
  return units === "imperial" ? `${lbFromKg(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

/** Signed weight change: "-1.5 lb" / "+0.7 kg". */
export function fmtWeightDelta(kg: number, units: UnitSystem): string {
  const v = units === "imperial" ? lbFromKg(kg) : kg;
  const unit = units === "imperial" ? "lb" : "kg";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} ${unit}`;
}

/** "3.11 mi" in imperial, "5.00 km" in metric. */
export function fmtDistanceM(m: number, units: UnitSystem): string {
  return units === "imperial" ? `${(m / M_PER_MI).toFixed(2)} mi` : `${(m / 1000).toFixed(2)} km`;
}

/** "8:03/mi" in imperial, "5:00/km" in metric. */
export function fmtPace(secPerKm: number, units: UnitSystem): string {
  const sec = units === "imperial" ? secPerKm * (M_PER_MI / 1000) : secPerKm;
  const whole = Math.round(sec);
  const label = units === "imperial" ? "/mi" : "/km";
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${label}`;
}

/** The unit word for a weight entry field: "lb" or "kg". */
export function weightUnit(units: UnitSystem): string {
  return units === "imperial" ? "lb" : "kg";
}

/** Convert a weight the user typed in display units to canonical kg. */
export function weightToKg(value: number, units: UnitSystem): number {
  return units === "imperial" ? kgFromLb(value) : value;
}
