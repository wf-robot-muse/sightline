// Garmin FIT workout exporter (spec v1.0 §5).
//
// Encodes a NeutralWorkout as a binary FIT workout file for USB copy
// to the watch's GARMIN/NewFiles folder. Structure mirrors the
// verified test file (file_id type=workout, workout, workout_step
// records, FIT CRC-16). Strength exercise names ride the
// reverse-engineered ExerciseTitleMessage (global 264): field 0
// wkt_step_name links to the step, field 1 exercise_category
// (0 = unknown), field 2 exercise_name. On-watch rendering of those
// names is part of the parked Phase 0 verification — the file is
// structurally valid FIT either way.

import type { NeutralWorkout, WorkoutStep } from "./workout.ts";

const FIT_EPOCH_OFFSET = 631065600; // 1989-12-31T00:00:00Z in unix seconds

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

export function fitCrc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

const SPORT_ENUM: Record<NeutralWorkout["sport"], number> = {
  running: 1,
  strength: 10, // training
  walking: 11,
  generic: 0,
};

const INTENSITY_ENUM: Record<WorkoutStep["kind"], number> = {
  warmup: 2,
  active: 0,
  interval: 0,
  rest: 1,
  cooldown: 3,
};

class FitWriter {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); }
  u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  str(s: string, size: number) {
    const encoded = new TextEncoder().encode(s);
    for (let i = 0; i < size; i++) this.bytes.push(i < encoded.length ? encoded[i]! : 0);
  }
  definition(local: number, global: number, fields: [number, number, number][]) {
    this.u8(0x40 | local);
    this.u8(0); // reserved
    this.u8(0); // little endian
    this.u16(global);
    this.u8(fields.length);
    for (const [num, size, type] of fields) { this.u8(num); this.u8(size); this.u8(type); }
  }
  dataHeader(local: number) { this.u8(local); }
}

const ENUM = 0x00, UINT16 = 0x84, UINT32 = 0x86, UINT32Z = 0x8c, STRING = 0x07;

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function encodeWorkoutFit(
  workout: NeutralWorkout,
  opts: { createdAt?: Date; serialNumber?: number } = {},
): Uint8Array {
  const w = new FitWriter();
  const created = opts.createdAt ?? new Date();
  const fitTime = Math.floor(created.getTime() / 1000) - FIT_EPOCH_OFFSET;
  const serial = opts.serialNumber ?? 305419896;

  // Expand repeats into an explicit repeat step (FIT style).
  type EncStep = { step: WorkoutStep } | { repeat: { stepCount: number; times: number } };
  const encSteps: EncStep[] = [];
  workout.steps.forEach((s, i) => {
    encSteps.push({ step: s });
    const r = workout.repeats.find((x) => x.afterStep === i);
    if (r) encSteps.push({ repeat: { stepCount: r.stepCount, times: r.times } });
  });

  // file_id (global 0), local 0
  w.definition(0, 0, [[0, 1, ENUM], [1, 2, UINT16], [2, 2, UINT16], [3, 4, UINT32Z], [4, 4, UINT32]]);
  w.dataHeader(0);
  w.u8(5); // type = workout
  w.u16(255); // manufacturer = development
  w.u16(0);
  w.u32(serial);
  w.u32(fitTime);

  // workout (global 26), local 1
  const nameSize = utf8Len(workout.name) + 1;
  w.definition(1, 26, [[4, 1, ENUM], [6, 2, UINT16], [8, nameSize, STRING]]);
  w.dataHeader(1);
  w.u8(SPORT_ENUM[workout.sport]);
  w.u16(encSteps.length);
  w.str(workout.name, nameSize);

  // exercise_title (global 264), local 3 — before the steps they name
  const titledSteps = workout.steps.filter((s) => s.exerciseName !== null);
  if (titledSteps.length > 0) {
    const stepNameSize = Math.max(...titledSteps.map((s) => utf8Len(s.name))) + 1;
    const exNameSize = Math.max(...titledSteps.map((s) => utf8Len(s.exerciseName!))) + 1;
    w.definition(3, 264, [[0, stepNameSize, STRING], [1, 2, UINT16], [2, exNameSize, STRING]]);
    for (const s of titledSteps) {
      w.dataHeader(3);
      w.str(s.name, stepNameSize);
      w.u16(0); // exercise_category unknown
      w.str(s.exerciseName!, exNameSize);
    }
  }

  // workout_step (global 27), local 2
  const stepNameSize = Math.max(...encSteps.map((e) => utf8Len("step" in e ? e.step.name : "Repeat"))) + 1;
  w.definition(2, 27, [
    [0, stepNameSize, STRING],
    [1, 1, ENUM], // duration_type
    [2, 4, UINT32], // duration_value
    [3, 1, ENUM], // target_type
    [4, 4, UINT32], // target_value
    [5, 4, UINT32], // custom_target_value_low
    [6, 4, UINT32], // custom_target_value_high
    [7, 1, ENUM], // intensity
  ]);
  for (const e of encSteps) {
    w.dataHeader(2);
    if ("repeat" in e) {
      w.str("Repeat", stepNameSize);
      w.u8(6); // repeat_until_steps_cmplt
      w.u32(e.repeat.stepCount);
      w.u8(0); // target_type speed/none placeholder
      w.u32(e.repeat.times); // target_value = repeat count
      w.u32(0); w.u32(0);
      w.u8(0);
      continue;
    }
    const s = e.step;
    w.str(s.name, stepNameSize);
    if (s.durationSec !== null) { w.u8(0); w.u32(s.durationSec * 1000); }
    else if (s.distanceM !== null) { w.u8(1); w.u32(s.distanceM * 100); }
    else { w.u8(5); w.u32(0); } // open
    switch (s.target.type) {
      case "hr-zone":
        w.u8(1); w.u32(s.target.zone); w.u32(0); w.u32(0);
        break;
      case "hr-range":
        // Custom HR range: values stored as bpm + 100 per FIT convention.
        w.u8(1); w.u32(0); w.u32(s.target.lowBpm + 100); w.u32(s.target.highBpm + 100);
        break;
      case "pace": {
        const speedMmS = (1000 / s.target.secPerKm) * 1000;
        w.u8(0); w.u32(0); w.u32(Math.round(speedMmS * 0.95)); w.u32(Math.round(speedMmS * 1.05));
        break;
      }
      case "none":
        w.u8(0); w.u32(0); w.u32(0); w.u32(0);
        break;
    }
    w.u8(INTENSITY_ENUM[s.kind]);
  }

  const dataBytes = new Uint8Array(w.bytes);
  const out = new Uint8Array(12 + dataBytes.length + 2);
  out[0] = 12; // header size
  out[1] = 0x20; // protocol version
  out[2] = 2132 & 0xff; out[3] = (2132 >> 8) & 0xff; // profile version 21.32
  out[4] = dataBytes.length & 0xff;
  out[5] = (dataBytes.length >> 8) & 0xff;
  out[6] = (dataBytes.length >> 16) & 0xff;
  out[7] = (dataBytes.length >>> 24) & 0xff;
  out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  out.set(dataBytes, 12);
  const crc = fitCrc16(out, 0, 12 + dataBytes.length);
  out[12 + dataBytes.length] = crc & 0xff;
  out[13 + dataBytes.length] = (crc >> 8) & 0xff;
  return out;
}
