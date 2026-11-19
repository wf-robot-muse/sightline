// Injury staged return paths, prevention, recurrence (spec v1.0 §7).
//
// Stage movement is criteria-based, never calendar-based (§7.2):
// advance when the last two pain reports show pain ≤2/10 during the
// session's patterns and no worse next morning; step back on a clear
// not-ready signal; hold otherwise. The engine assesses — the app
// records the stage change with the assessment attached.

import type { InjuryRecord, MovementPattern } from "./model.ts";
import { ValidationError } from "./validate.ts";

export interface PainReport {
  injuryId: string;
  date: string; // YYYY-MM-DD
  painDuring: number; // 0-10 during work on the affected patterns
  painNextMorning: number; // 0-10 the following morning
}

export function validatePainReport(r: PainReport): void {
  for (const [field, v] of [["painDuring", r.painDuring], ["painNextMorning", r.painNextMorning]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 10) {
      throw new ValidationError(`painReport.${field}`, `out of range 0-10: ${v}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new ValidationError("painReport.date", `invalid date: ${r.date}`);
}

export interface StageAssessment {
  action: "advance" | "hold" | "step-back";
  fromStage: 1 | 2 | 3;
  toStage: 1 | 2 | 3;
  reasons: string[];
}

export function assessStage(injury: InjuryRecord, reports: PainReport[]): StageAssessment {
  const mine = reports
    .filter((r) => r.injuryId === injury.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const from = injury.stage;
  const stay: StageAssessment = { action: "hold", fromStage: from, toStage: from, reasons: [] };
  if (injury.status === "resolved") {
    return { ...stay, reasons: ["Injury is resolved; prevention allocation applies instead."] };
  }
  const last = mine[mine.length - 1];
  if (!last) return { ...stay, reasons: ["No pain reports yet; stage holds."] };

  if (last.painDuring >= 5 || last.painNextMorning >= last.painDuring + 3) {
    const to = Math.max(1, from - 1) as 1 | 2 | 3;
    return {
      action: to === from ? "hold" : "step-back",
      fromStage: from,
      toStage: to,
      reasons: [
        `Latest report (${last.date}): pain ${last.painDuring}/10 during, ${last.painNextMorning}/10 next morning — not-ready signal.`,
        to === from ? "Already at stage 1; hold and settle." : `Step back to stage ${to}.`,
      ],
    };
  }
  const prev = mine[mine.length - 2];
  const calm = (r: PainReport) => r.painDuring <= 2 && r.painNextMorning <= r.painDuring + 1;
  if (prev && calm(last) && calm(prev)) {
    const to = Math.min(3, from + 1) as 1 | 2 | 3;
    return {
      action: to === from ? "hold" : "advance",
      fromStage: from,
      toStage: to,
      reasons: [
        `Two consecutive calm reports (pain ≤2/10 during, no worse next morning).`,
        to === from ? "Already at stage 3 (return); progress load gradually." : `Advance to stage ${to}.`,
      ],
    };
  }
  return {
    ...stay,
    reasons: [
      `Latest report (${last.date}): pain ${last.painDuring}/10 during, ${last.painNextMorning}/10 next morning — criteria for stage movement not met; hold at stage ${from}.`,
    ],
  };
}

const PREVENTION_BY_PATTERN: Record<MovementPattern, string> = {
  "squat": "Squat-pattern strength maintenance",
  "hinge": "Core endurance + hinge technique micro-dose",
  "lunge": "Single-leg balance + quadriceps maintenance",
  "push-horizontal": "Shoulder and scapular maintenance",
  "push-vertical": "Shoulder and rotator-cuff maintenance",
  "pull": "Scapular and rotator-cuff maintenance",
  "carry": "Grip and trunk-bracing maintenance",
  "run": "Calf/ankle capacity + balance work",
  "core-stability": "Core endurance micro-dose",
  "mobility": "Joint mobility maintenance",
};

export interface PreventionItem {
  pattern: MovementPattern;
  item: string;
  timesPerWeek: number;
  reason: string;
}

/** Maintenance allocations for resolved injuries (§7.4): prevention
 *  stays in the plan so the same injury is less likely to recur. */
export function preventionAllocations(injuries: InjuryRecord[]): PreventionItem[] {
  const out = new Map<MovementPattern, PreventionItem>();
  for (const inj of injuries) {
    if (inj.status !== "resolved") continue;
    for (const p of inj.affectedPatterns) {
      if (!out.has(p)) {
        out.set(p, {
          pattern: p,
          item: PREVENTION_BY_PATTERN[p],
          timesPerWeek: 2,
          reason: `Prevention for resolved ${inj.bodyArea} injury (onset ${inj.onsetDate}).`,
        });
      }
    }
  }
  return [...out.values()];
}

/** A new log for the same body area as a resolved injury reopens
 *  that record (§7.4) rather than starting a duplicate. */
export function findRecurrence(injuries: InjuryRecord[], bodyArea: string): InjuryRecord | null {
  const target = bodyArea.trim().toLowerCase();
  const matches = injuries
    .filter((i) => i.status === "resolved" && i.bodyArea.trim().toLowerCase() === target)
    .sort((a, b) => b.onsetDate.localeCompare(a.onsetDate));
  return matches[0] ?? null;
}
