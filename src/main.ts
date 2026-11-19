// SightLine app shell (Phase 3).
//
// Screens: Today, Goals, Check-ins, Fasting, Injuries, Equipment,
// Data, Settings. All logic comes from the platform-independent
// engine (../engine); this file is rendering and data entry only.
//
// Security (Wade's standing rule): user text is rendered as text,
// never as HTML; inputs are validated and length-capped at entry
// through the engine's validators; persisted data is re-validated
// on load (see store.ts).

import "./styles.css";
import {
  assessStage,
  computeNutritionTargets,
  computeReadiness,
  cronometerCsvToNutritionDays,
  encodeWorkoutFit,
  estimateExpenditure,
  findRecurrence,
  formatStatement,
  garminDayBundleToObservations,
  manualObservations,
  normalizeGoals,
  planWeek,
  preventionAllocations,
  resolveObservations,
  scoreNutritionWeek,
  sessionToWorkout,
  teladocExtractionToCanonical,
  validatePainReport,
  workoutCard,
  METRIC_RANGES,
} from "../engine/src/index.ts";
import type {
  GoalType,
  InjuryRecord,
  MetricKind,
  MovementPattern,
} from "../engine/src/index.ts";
import { emptyStore, loadStore, mondayOf, newId, saveStore, todayLocal } from "./store.ts";
import type { AppStore } from "./store.ts";
import { isSampleId, sampleStore } from "./sample.ts";

const { store: loadedStore, dropped } = loadStore();
let store: AppStore = loadedStore;
let currentView = "today";
let notice = dropped > 0 ? `Store load: ${dropped} stored record(s) failed validation and were dropped.` : "";

function save(): void {
  saveStore(store);
}

function nowIso(): string {
  return new Date().toISOString();
}

function prov(source: "manual" | "in-app-log", recordedAt: string) {
  return { source, recordedAt, enteredAt: nowIso() };
}

// ---------- DOM helpers (text-only rendering) ----------

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function labeledInput(label: string, input: HTMLElement): HTMLElement {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function textInput(value = "", max = 200): HTMLInputElement {
  const i = h("input", { type: "text", maxlength: String(max) });
  i.value = value;
  return i;
}

function numInput(value = "", step = "any"): HTMLInputElement {
  const i = h("input", { type: "number", step });
  i.value = value;
  return i;
}

function dateInput(value = ""): HTMLInputElement {
  const i = h("input", { type: "date" });
  i.value = value;
  return i;
}

function selectInput(options: [string, string][], value = ""): HTMLSelectElement {
  const s = h("select");
  for (const [v, label] of options) s.append(h("option", { value: v }, label));
  s.value = value;
  return s;
}

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls }, label);
  b.addEventListener("click", onClick);
  return b;
}

function card(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "card" }, h("h2", {}, title), ...children);
}

function setNotice(text: string): void {
  notice = text;
  render();
}

// ---------- Today ----------

function viewToday(root: HTMLElement): void {
  const today = todayLocal();
  const goals = normalizeGoals(store.goals);
  const readiness = computeReadiness(store.observations, store.workouts, store.injuries, today);
  const week = planWeek(store, goals, mondayOf(today));
  const todaysSession = week.sessions.find((s) => s.date === today);

  const tierCard = card(
    `Readiness — ${today}`,
    h("p", { class: `tier tier-${readiness.tier}` }, readiness.tier.toUpperCase()),
    h("p", {}, `Confidence: ${readiness.confidence}. Score: ${readiness.score}.`),
    readiness.missingInputs.length > 0
      ? h("p", { class: "warn" }, `Missing inputs: ${readiness.missingInputs.join(", ")}. Recommendations narrow to what the remaining data supports.`)
      : null,
    ...readiness.signals.map((s) => h("p", { class: "signal" }, s.detail)),
    readiness.acwr !== null ? h("p", { class: "signal" }, `Acute:chronic workload ratio ${readiness.acwr.toFixed(2)} (band 0.8–1.3).`) : null,
  );
  root.append(tierCard);

  if (todaysSession) {
    const workout = sessionToWorkout(todaysSession);
    root.append(
      card(
        "Today's session",
        h("p", { class: "session-kind" }, `${todaysSession.kind} — ${todaysSession.durationMin} min`),
        ...todaysSession.reasons.map((r) => h("p", { class: "signal" }, r)),
        workout
          ? h("pre", { class: "workout-card" }, workoutCard(workout))
          : h("p", { class: "signal" }, "Practice session — not a workout, no export."),
        workout
          ? button("Download FIT workout file (for GARMIN/NewFiles)", () => {
              const bytes = encodeWorkoutFit(workout);
              const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
              const url = URL.createObjectURL(blob);
              const a = h("a", { href: url, download: `${workout.id}.fit` });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
              setNotice("FIT file downloaded. Copy it to the watch's GARMIN/NewFiles folder by USB to load the workout.");
            })
          : null,
      ),
    );
  } else {
    root.append(card("Today's session", h("p", {}, "No session planned. Add goals and data to begin.")));
  }

  const latestWeight = [...resolveObservations(store.observations)]
    .filter((o) => o.metric === "weight-kg")
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  const expenditure = estimateExpenditure(store.observations, store.nutrition);
  const fastingToday = store.fasts.some(
    (f) => f.startedAt.slice(0, 10) <= today && (f.endedAt === null || f.endedAt.slice(0, 10) >= today),
  );
  const targets = computeNutritionTargets({
    goals,
    bodyWeightKg: latestWeight ? latestWeight.value : null,
    expenditureKcal: expenditure.kcalPerDay,
    fastingToday,
  });
  root.append(
    card(
      "Nutrition targets",
      targets.mode === "fasting"
        ? h("p", {}, "Fasting day: electrolyte and hydration targets apply.")
        : targets.kcal !== null
          ? h("p", {}, `${targets.kcal} kcal · protein ${targets.proteinG} g · net carbs ${targets.carbsNetG} g · fat ${targets.fatG} g`)
          : h("p", {}, "Not computed: a current weight and an expenditure estimate are required."),
      ...targets.detail.map((d) => h("p", { class: "signal" }, d)),
      h("p", { class: "signal" }, `Sodium ${targets.micros.sodiumMg[0]}–${targets.micros.sodiumMg[1]} mg · potassium ${targets.micros.potassiumMg[0]}–${targets.micros.potassiumMg[1]} mg · magnesium ${targets.micros.magnesiumMg[0]}–${targets.micros.magnesiumMg[1]} mg · fiber ${targets.micros.fiberG[0]}–${targets.micros.fiberG[1]} g`),
    ),
  );

  root.append(
    card(
      "This week",
      h(
        "ul",
        { class: "week" },
        ...week.sessions.map((s) =>
          h("li", {}, `${s.date}: ${s.kind} ${s.durationMin} min${s.date === today ? " (today)" : ""}`),
        ),
      ),
      ...week.benchmarks.map((b) => h("p", { class: "signal" }, b)),
    ),
  );

  const activeInjuries = store.injuries.filter((i) => i.status !== "resolved");
  if (activeInjuries.length > 0) {
    root.append(
      card(
        "Active injuries",
        ...activeInjuries.map((i) =>
          h("p", { class: i.redFlags.length > 0 ? "warn" : "signal" },
            `${i.bodyArea}: pain ${i.pain0to10}/10, stage ${i.stage}, status ${i.status}` +
            (i.redFlags.length > 0 ? ` — RED FLAGS: ${i.redFlags.join(", ")}. Programming for the affected patterns is stopped; get this evaluated in person.` : "")),
        ),
      ),
    );
  }

  const prevention = preventionAllocations(store.injuries);
  if (prevention.length > 0) {
    root.append(
      card(
        "Injury prevention (maintenance)",
        ...prevention.map((p) => h("p", { class: "signal" }, `${p.item} — ${p.timesPerWeek}×/week. ${p.reason}`)),
      ),
    );
  }

  root.append(
    card(
      "Statement",
      h("p", {}, formatStatement({
        observation: readiness.signals.map((s) => s.detail).join(" ") || "No readiness data recorded yet.",
        benchmark: week.benchmarks[0] ?? null,
        opinion: readiness.tier === "red" ? "today's work should stay at recovery level; the planned intensity belongs on a green day." : null,
      })),
    ),
  );
}

// ---------- Goals ----------

const GOAL_TYPES: [GoalType, string][] = [
  ["fat-loss", "Fat loss / weight"],
  ["muscle", "Muscle / strength"],
  ["sleep", "Sleep"],
  ["core-strength", "Core strength"],
  ["lower-back", "Lower-back strength and resiliency"],
];

function viewGoals(root: HTMLElement): void {
  const goals = normalizeGoals(store.goals);
  const list = card(
    "Goals & weights",
    store.goals.length === 0
      ? h("p", {}, "No goals yet. The app ships with an empty goal list; goals are your data, entered here.")
      : h(
          "ul",
          { class: "items" },
          ...store.goals.map((g) => {
            const norm = goals.find((n) => n.id === g.id);
            return h(
              "li",
              {},
              `${GOAL_TYPES.find((t) => t[0] === g.type)?.[1] ?? g.type}` +
                (g.target !== null ? ` — target ${g.target} ${g.targetUnit ?? ""}` : "") +
                (g.deadline ? ` by ${g.deadline}` : "") +
                ` · weight ${g.weight}${norm ? ` (${Math.round(norm.normalizedWeight * 100)}%)` : ""}` +
                (g.active ? "" : " · inactive") +
                (isSampleId(g.id) ? " · SAMPLE" : ""),
              " ",
              button(g.active ? "Deactivate" : "Activate", () => {
                g.active = !g.active;
                save();
                render();
              }),
              " ",
              button("Delete", () => {
                store.goals = store.goals.filter((x) => x.id !== g.id);
                save();
                render();
              }),
            );
          }),
        ),
  );
  root.append(list);

  const type = selectInput(GOAL_TYPES, "fat-loss");
  const target = numInput();
  const unit = textInput("", 20);
  const deadline = dateInput();
  const weight = numInput("50", "1");
  const form = card(
    "Add a goal",
    h("div", { class: "form" },
      labeledInput("Type", type),
      labeledInput("Target (optional)", target),
      labeledInput("Target unit (optional)", unit),
      labeledInput("Deadline (optional)", deadline),
      labeledInput("Priority weight", weight),
      button("Add goal", () => {
        const w = Number(weight.value);
        if (!Number.isFinite(w) || w <= 0) return setNotice("Goal weight must be a positive number.");
        store.goals.push({
          id: newId("goal"),
          type: type.value as GoalType,
          target: target.value === "" ? null : Number(target.value),
          targetUnit: unit.value.trim() === "" ? null : unit.value.trim().slice(0, 20),
          deadline: deadline.value === "" ? null : deadline.value,
          weight: w,
          active: true,
        });
        save();
        setNotice("Goal added. The plan has been regenerated with the new weights.");
      }),
    ),
  );
  root.append(form);
}

// ---------- Check-ins ----------

function viewCheckIns(root: HTMLElement): void {
  const today = todayLocal();
  const existing = store.checkIns.find((c) => c.date === today);
  const soreness = numInput(existing?.soreness?.toString() ?? "", "1");
  const stiffness = numInput(existing?.backStiffness?.toString() ?? "", "1");
  const mood = numInput(existing?.mood?.toString() ?? "", "1");
  const rpe = numInput(existing?.sessionRpe?.toString() ?? "", "1");
  const note = textInput(existing?.note ?? "", 500);
  const scale = (i: HTMLInputElement): number | null => {
    if (i.value === "") return null;
    const n = Number(i.value);
    return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
  };
  root.append(
    card(
      `Check-in — ${today}`,
      h("div", { class: "form" },
        labeledInput("Soreness 0–10", soreness),
        labeledInput("Back stiffness 0–10", stiffness),
        labeledInput("Mood 0–10", mood),
        labeledInput("Session RPE 0–10", rpe),
        labeledInput("Note", note),
        button("Save check-in", () => {
          const entry = {
            date: today,
            soreness: scale(soreness),
            backStiffness: scale(stiffness),
            mood: scale(mood),
            sessionRpe: scale(rpe),
            note: note.value.trim() === "" ? null : note.value.trim().slice(0, 500),
            provenance: prov("in-app-log", today),
          };
          store.checkIns = [...store.checkIns.filter((c) => c.date !== today), entry];
          save();
          setNotice("Check-in saved. Today's plan has been regenerated.");
        }),
      ),
    ),
  );
  const recent = [...store.checkIns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  if (recent.length > 0) {
    root.append(
      card(
        "Recent check-ins",
        h("ul", { class: "items" }, ...recent.map((c) =>
          h("li", {}, `${c.date}: soreness ${c.soreness ?? "—"}, back stiffness ${c.backStiffness ?? "—"}, mood ${c.mood ?? "—"}, RPE ${c.sessionRpe ?? "—"}${c.note ? ` — ${c.note}` : ""}`),
        )),
      ),
    );
  }
}

// ---------- Fasting ----------

function viewFasting(root: HTMLElement): void {
  const open = store.fasts.find((f) => f.endedAt === null);
  const controls = open
    ? h("p", {}, `Fast in progress since ${open.startedAt}. `,
        button("End fast now", () => {
          open.endedAt = nowIso();
          save();
          setNotice("Fast ended. The plan has been regenerated.");
        }))
    : h("p", {}, button("Start a fast now", () => {
        store.fasts.push({ startedAt: nowIso(), endedAt: null, provenance: prov("in-app-log", todayLocal()) });
        save();
        setNotice("Fast started. Today's plan is now fasting-aware.");
      }));
  root.append(card("Fasting log", controls,
    h("p", { class: "signal" }, "No external source captures fasting; this log is what makes the plan fasting-aware. On a full water-fast day the planner allows walking and mobility only.")));
  const past = [...store.fasts].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 14);
  if (past.length > 0) {
    root.append(card("Recent fasts", h("ul", { class: "items" }, ...past.map((f) => {
      const hours = f.endedAt ? Math.round(((Date.parse(f.endedAt) - Date.parse(f.startedAt)) / 3600000) * 10) / 10 : null;
      return h("li", {}, `${f.startedAt.slice(0, 16).replace("T", " ")} → ${f.endedAt ? f.endedAt.slice(0, 16).replace("T", " ") : "in progress"}${hours !== null ? ` (${hours} h)` : ""}`);
    }))));
  }
}

// ---------- Injuries ----------

const PATTERNS: MovementPattern[] = [
  "squat", "hinge", "lunge", "push-horizontal", "push-vertical", "pull", "carry", "run", "core-stability", "mobility",
];

function viewInjuries(root: HTMLElement): void {
  if (store.injuries.length > 0) {
    root.append(
      card(
        "Injury log",
        h("ul", { class: "items" }, ...store.injuries.map((inj) =>
          h("li", {},
            `${inj.bodyArea} (${inj.side}) — pain ${inj.pain0to10}/10, stage ${inj.stage}, ${inj.status}` +
            (inj.redFlags.length > 0 ? ` — RED FLAGS: ${inj.redFlags.join(", ")}` : "") +
            (isSampleId(inj.id) ? " · SAMPLE" : ""),
            " ",
            inj.status !== "resolved"
              ? button("Mark resolved", () => {
                  inj.status = "resolved";
                  save();
                  render();
                })
              : null,
            " ",
            button("Delete", () => {
              store.injuries = store.injuries.filter((x) => x.id !== inj.id);
              save();
              render();
            }),
          ),
        )),
        h("p", { class: "signal" }, "A resolved injury stays in the profile as a standing risk entry (spec §7.4) — deleting removes that history." ),
      ),
    );

    const active = store.injuries.filter((i) => i.status !== "resolved");
    if (active.length > 0) {
      root.append(
        card(
          "Stage assessment & pain reports",
          h("p", { class: "signal" }, "Stages move on criteria, not calendar: two calm reports (pain ≤2 during, no worse next morning) advance; a flare steps back. Log a report after sessions that load the affected patterns."),
          ...active.flatMap((inj) => {
            const assessment = assessStage(inj, store.injuryReports);
            const during = numInput("", "1");
            const morning = numInput("", "1");
            const rows: Child[] = [
              h("p", { class: "session-kind" }, `${inj.bodyArea} — stage ${inj.stage}: ${assessment.action}`),
              ...assessment.reasons.map((r) => h("p", { class: "signal" }, r)),
              h("div", { class: "form" },
                labeledInput("Pain during (0–10)", during),
                labeledInput("Pain next morning (0–10)", morning),
                button("Log pain report", () => {
                  try {
                    const rep = {
                      injuryId: inj.id,
                      date: todayLocal(),
                      painDuring: Number(during.value),
                      painNextMorning: Number(morning.value),
                    };
                    validatePainReport(rep);
                    store.injuryReports.push(rep);
                    save();
                    render();
                  } catch (err) {
                    setNotice(`Pain report rejected: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }),
                assessment.action !== "hold" && assessment.toStage !== inj.stage
                  ? button(`Apply: move to stage ${assessment.toStage}`, () => {
                      inj.stage = assessment.toStage;
                      save();
                      render();
                    })
                  : null,
              ),
            ];
            return rows;
          }),
        ),
      );
    }
  }

  const area = textInput("", 60);
  const side = selectInput([["na", "n/a"], ["left", "left"], ["right", "right"], ["both", "both"]], "na");
  const onset = dateInput(todayLocal());
  const how = textInput("", 200);
  const pain = numInput("5", "1");
  const worse = textInput("", 200);
  const better = textInput("", 200);
  const stage = selectInput([["1", "Stage 1 — settle"], ["2", "Stage 2 — reload"], ["3", "Stage 3 — return"]], "1");
  const redFlags = textInput("", 200);
  const checks = PATTERNS.map((p) => {
    const box = h("input", { type: "checkbox", value: p });
    return { pattern: p, box, label: h("label", { class: "check" }, box, ` ${p}`) };
  });

  root.append(
    card(
      "Log a possible injury",
      h("p", { class: "signal" }, "Recorded in your words. The app never diagnoses; it tracks what you report and works around it. A professional's diagnosis or instructions, when you enter them in the app later, outrank app output."),
      h("div", { class: "form" },
        labeledInput("Body area", area),
        labeledInput("Side", side),
        labeledInput("Onset date", onset),
        labeledInput("How it started", how),
        labeledInput("Pain 0–10", pain),
        labeledInput("Worse with", worse),
        labeledInput("Better with", better),
        labeledInput("Stage", stage),
        labeledInput("Red flags (comma-separated: numbness/tingling, radiating pain, instability, major swelling, night pain)", redFlags),
        h("fieldset", {}, h("legend", {}, "Affected movement patterns"), ...checks.map((c) => c.label)),
        button("Log injury", () => {
          const p = Number(pain.value);
          if (area.value.trim() === "") return setNotice("Body area is required.");
          if (!Number.isFinite(p) || p < 0 || p > 10) return setNotice("Pain must be 0–10.");
          const record: InjuryRecord = {
            id: newId("injury"),
            bodyArea: area.value.trim().slice(0, 60),
            side: side.value as InjuryRecord["side"],
            onsetDate: onset.value || todayLocal(),
            onsetDescription: how.value.trim().slice(0, 200),
            pain0to10: p,
            worseWith: worse.value.trim().slice(0, 200),
            betterWith: better.value.trim().slice(0, 200),
            affectedPatterns: checks.filter((c) => c.box.checked).map((c) => c.pattern),
            status: "active",
            stage: Number(stage.value) as 1 | 2 | 3,
            redFlags: redFlags.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8),
            professionalNotes: null,
            provenance: prov("in-app-log", todayLocal()),
          };
          const recurrence = findRecurrence(store.injuries, record.bodyArea);
          if (recurrence) {
            recurrence.status = "active";
            recurrence.stage = Math.max(1, recurrence.stage - 1) as 1 | 2 | 3;
            recurrence.pain0to10 = record.pain0to10;
            recurrence.onsetDate = record.onsetDate;
            recurrence.onsetDescription = record.onsetDescription;
            recurrence.redFlags = record.redFlags;
            save();
            setNotice(`This matches your resolved ${recurrence.bodyArea} injury — that record has been reopened at stage ${recurrence.stage} (history kept) instead of starting a duplicate.`);
            return;
          }
          store.injuries.push(record);
          save();
          setNotice(record.redFlags.length > 0
            ? "Injury logged with red flags. Programming for the affected patterns is stopped — get this evaluated in person."
            : "Injury logged. The plan has been regenerated around the affected patterns.");
        }),
      ),
    ),
  );
}

// ---------- Equipment ----------

function viewEquipment(root: HTMLElement): void {
  const name = textInput("", 120);
  root.append(
    card(
      "Equipment inventory",
      store.equipment.length === 0
        ? h("p", {}, "No equipment recorded. Exercise selection will be constrained to this list as the exercise library lands (Phase 3).")
        : h("ul", { class: "items" }, ...store.equipment.map((e) =>
            h("li", {}, `${e.name}${isSampleId(e.id) ? " · SAMPLE" : ""} `,
              button("Delete", () => {
                store.equipment = store.equipment.filter((x) => x.id !== e.id);
                save();
                render();
              })),
          )),
      h("div", { class: "form" },
        labeledInput("Add equipment", name),
        button("Add", () => {
          if (name.value.trim() === "") return;
          store.equipment.push({ id: newId("eq"), name: name.value.trim().slice(0, 120), provenance: prov("manual", todayLocal()) });
          save();
          render();
        }),
      ),
    ),
  );
}

// ---------- Data ----------

function fileButton(label: string, accept: string, handler: (text: string, name: string) => void): HTMLElement {
  const input = h("input", { type: "file", accept });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    handler(await file.text(), file.name);
  });
  return h("label", { class: "file-btn" }, label, input);
}

function viewData(root: HTMLElement): void {
  const counts = card(
    "Data on this machine",
    h("p", {}, `Observations: ${store.observations.length} · BP readings: ${store.bloodPressure.length} · Workouts: ${store.workouts.length} · Nutrition days: ${store.nutrition.length} · Fasts: ${store.fasts.length} · Check-ins: ${store.checkIns.length} · Injuries: ${store.injuries.length}`),
    h("p", { class: "signal" }, "Every value carries its source and timestamps. When two sources report the same metric for a day, both are kept and the declared source priority decides what the engine reads (Garmin is the step source of record)."),
  );
  root.append(counts);

  const recentNutrition = [...store.nutrition].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  if (recentNutrition.length > 0) {
    const latestWeight = [...resolveObservations(store.observations)]
      .filter((o) => o.metric === "weight-kg")
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop();
    const expenditure = estimateExpenditure(store.observations, store.nutrition);
    const targets = computeNutritionTargets({
      goals: normalizeGoals(store.goals),
      bodyWeightKg: latestWeight ? latestWeight.value : null,
      expenditureKcal: expenditure.kcalPerDay,
      fastingToday: false,
    });
    if (targets.kcal !== null) {
      const weekScore = scoreNutritionWeek(recentNutrition, targets);
      root.append(
        card(
          "Nutrition scoring (last 7 logged days vs current targets)",
          h("p", { class: "signal" }, "A nutrient missing from a log counts as not-logged, never as zero."),
          ...weekScore.byNutrient.map((n) =>
            h("p", { class: "signal" }, `${n.nutrient}: met ${n.met} · low ${n.low} · high ${n.high} · not logged ${n.notLogged} (of ${weekScore.loggedDays} days)`),
          ),
        ),
      );
    } else {
      root.append(card("Nutrition scoring", h("p", {}, "Not scored: targets need a current weight and an expenditure estimate (logged nutrition days plus a weight series).")));
    }
  }

  const metric = selectInput(Object.keys(METRIC_RANGES).map((m) => [m, m] as [string, string]), "weight-kg");
  const value = numInput();
  const date = dateInput(todayLocal());
  root.append(
    card(
      "Manual entry",
      h("p", { class: "signal" }, "Manual entry has parity with every import: the engine runs end-to-end on manual-only data."),
      h("div", { class: "form" },
        labeledInput("Metric", metric),
        labeledInput("Value", value),
        labeledInput("Date", date),
        button("Add entry", () => {
          try {
            const [obs] = manualObservations(
              [{ metric: metric.value as MetricKind, value: Number(value.value), date: date.value }],
              nowIso(),
            );
            store.observations.push(obs);
            save();
            setNotice("Entry added.");
          } catch (err) {
            setNotice(`Entry rejected: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      ),
    ),
  );

  root.append(
    card(
      "Imports",
      h("p", { class: "signal" }, "A vendor format change fails loudly at import time with a named error — imports never silently corrupt engine inputs."),
      h("div", { class: "form" },
        fileButton("Import Garmin day-bundle JSON", ".json", (text) => {
          try {
            const parsed: unknown = JSON.parse(text);
            const bundles = Array.isArray(parsed) ? parsed : [parsed];
            let added = 0;
            for (const b of bundles) {
              store.observations.push(...garminDayBundleToObservations(b, nowIso()));
              added++;
            }
            save();
            setNotice(`Imported ${added} Garmin day bundle(s).`);
          } catch (err) {
            setNotice(`Garmin import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
        fileButton("Import Teladoc extraction JSON", ".json", (text) => {
          try {
            const result = teladocExtractionToCanonical(JSON.parse(text), nowIso());
            store.observations.push(...result.observations);
            store.bloodPressure.push(...result.bloodPressure);
            save();
            setNotice(`Teladoc import: ${result.observations.length} observation(s), ${result.bloodPressure.length} BP reading(s). The PDF's weight series is chart-only and is not imported.`);
          } catch (err) {
            setNotice(`Teladoc import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
        fileButton("Import Cronometer Daily Nutrition CSV", ".csv", (text) => {
          try {
            const days = cronometerCsvToNutritionDays(text, nowIso());
            const byDate = new Map(store.nutrition.map((d) => [d.date, d]));
            for (const d of days) byDate.set(d.date, d);
            store.nutrition = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
            save();
            setNotice(`Cronometer import: ${days.length} day(s). Import-only — the app never accesses your Cronometer account.`);
          } catch (err) {
            setNotice(`Cronometer import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      ),
    ),
  );
}

// ---------- Settings ----------

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename }, "download");
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function viewSettings(root: HTMLElement): void {
  root.append(
    card(
      "Settings",
      h("div", { class: "form" },
        button("Export all data (JSON)", () => download("sightline-data.json", JSON.stringify(store, null, 2))),
        fileButton("Import data file (replaces current data)", ".json", (text) => {
          try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) throw new Error("not a data file");
            localStorage.setItem("sightline.store.v1", JSON.stringify(parsed));
            const reloaded = loadStore();
            store = reloaded.store;
            save();
            setNotice(`Data imported.${reloaded.dropped > 0 ? ` ${reloaded.dropped} record(s) failed validation and were dropped.` : ""}`);
          } catch (err) {
            setNotice(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
        button("Load sample data (labeled SAMPLE, replaces current data)", () => {
          store = sampleStore();
          save();
          setNotice("Sample data loaded. Sample entries are labeled SAMPLE and are never treated as your data.");
        }),
        button("Delete sample data only", () => {
          store.goals = store.goals.filter((g) => !isSampleId(g.id));
          store.equipment = store.equipment.filter((e) => !isSampleId(e.id));
          store.injuries = store.injuries.filter((i) => !isSampleId(i.id));
          if (store.goals.length === 0 && store.observations.every((o) => o.provenance.source === "manual")) {
            // Sample observations are manual-sourced synthetic days; if
            // nothing else remains, clear them too.
            const hasRealGoals = store.goals.length > 0;
            if (!hasRealGoals) store.observations = [];
          }
          save();
          setNotice("Sample goals and equipment removed.");
        }),
        button("Erase all data", () => {
          store = emptyStore();
          save();
          setNotice("All data erased from this machine.");
        }),
      ),
      h("p", { class: "signal" }, "SightLine is a training and nutrition coach, not a medical device: no diagnoses, no medication content. Out-of-range BP readings or rapid weight changes are prompts to contact your care team, not app advice."),
    ),
  );
}

// ---------- Shell ----------

const VIEWS: [string, string, (root: HTMLElement) => void][] = [
  ["today", "Today", viewToday],
  ["goals", "Goals", viewGoals],
  ["checkins", "Check-ins", viewCheckIns],
  ["fasting", "Fasting", viewFasting],
  ["injuries", "Injuries", viewInjuries],
  ["equipment", "Equipment", viewEquipment],
  ["data", "Data", viewData],
  ["settings", "Settings", viewSettings],
];

function render(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  app.replaceChildren();
  app.append(
    h("header", {},
      h("h1", {}, "SightLine"),
      h("p", { class: "subtitle" }, "Daily training, activity, and nutrition from your data and your weighted goals."),
    ),
    h("nav", { class: "nav" }, ...VIEWS.map(([id, label]) =>
      button(label, () => {
        currentView = id;
        render();
      }, id === currentView ? "nav-btn active" : "nav-btn"),
    )),
  );
  if (notice) app.append(h("p", { class: "notice" }, notice));
  const main = h("main", { class: "view" });
  VIEWS.find(([id]) => id === currentView)?.[2](main);
  app.append(main);
}

window.addEventListener("DOMContentLoaded", render);
