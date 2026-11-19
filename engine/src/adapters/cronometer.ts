// Cronometer CSV adapter — IMPORT-ONLY (spec §3.1).
//
// Cronometer's terms prohibit automated/AI access to the account;
// this adapter only ever reads a CSV file Wade exported himself
// (Account Settings → Export Data → Daily Nutrition). It never logs
// in, scrapes, or writes back.
//
// PROVISIONAL CONTRACT: Phase 0 test (b) — parsing one real export —
// is on hold at Wade's direction (Nov 18, 2026), so the column set
// below is the documented Daily Nutrition export shape, not yet
// verified against a real file. The contract is strict on purpose:
// an export whose headers do not match fails loudly at import time
// instead of silently corrupting engine inputs (spec §3). When the
// real export is parsed, this header list gets corrected to match it
// and the fixture test is updated in the same change.

import type { NutritionDay } from "../model.ts";
import { AdapterError } from "./garmin.ts";
import { optionalRange, requireDate } from "../validate.ts";

const EXPECTED_COLUMNS = [
  "Date",
  "Energy (kcal)",
  "Protein (g)",
  "Carbs (g)",
  "Fiber (g)",
  "Net Carbs (g)",
  "Fat (g)",
  "Sodium (mg)",
  "Potassium (mg)",
  "Magnesium (mg)",
  "Calcium (mg)",
  "Vitamin D (IU)",
  "Omega-3 (g)",
] as const;

/** Minimal CSV reader: handles quoted fields and embedded commas.
 *  Input is capped (a Daily Nutrition export is one row per day). */
export function parseCsv(text: string): string[][] {
  if (text.length > 5_000_000) throw new AdapterError("cronometer csv: file exceeds 5 MB cap");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function cell(row: string[], idx: number): number | null {
  const raw = (row[idx] ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function cronometerCsvToNutritionDays(csvText: string, enteredAt: string): NutritionDay[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new AdapterError("cronometer csv: no data rows");
  const header = rows[0].map((h) => h.trim());
  const index = new Map<string, number>();
  for (const col of EXPECTED_COLUMNS) {
    const i = header.indexOf(col);
    if (i === -1) {
      throw new AdapterError(
        `cronometer csv: expected column "${col}" not found — export format may have changed`,
      );
    }
    index.set(col, i);
  }
  const at = (row: string[], col: string) => cell(row, index.get(col)!);

  const days: NutritionDay[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const date = requireDate((row[index.get("Date")!] ?? "").trim(), "cronometer.Date");
    if (seen.has(date)) continue; // incremental imports dedupe by date (§3.1)
    seen.add(date);
    days.push({
      date,
      kcal: optionalRange(at(row, "Energy (kcal)"), "cronometer.kcal", 0, 25000),
      proteinG: optionalRange(at(row, "Protein (g)"), "cronometer.protein", 0, 2000),
      carbsNetG: optionalRange(at(row, "Net Carbs (g)"), "cronometer.netCarbs", 0, 5000),
      fatG: optionalRange(at(row, "Fat (g)"), "cronometer.fat", 0, 2000),
      fiberG: optionalRange(at(row, "Fiber (g)"), "cronometer.fiber", 0, 500),
      sodiumMg: optionalRange(at(row, "Sodium (mg)"), "cronometer.sodium", 0, 50000),
      potassiumMg: optionalRange(at(row, "Potassium (mg)"), "cronometer.potassium", 0, 50000),
      magnesiumMg: optionalRange(at(row, "Magnesium (mg)"), "cronometer.magnesium", 0, 10000),
      calciumMg: optionalRange(at(row, "Calcium (mg)"), "cronometer.calcium", 0, 20000),
      vitaminDIu: optionalRange(at(row, "Vitamin D (IU)"), "cronometer.vitaminD", 0, 100000),
      omega3G: optionalRange(at(row, "Omega-3 (g)"), "cronometer.omega3", 0, 500),
      provenance: { source: "cronometer-csv", recordedAt: date, enteredAt },
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
