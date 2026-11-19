// Coaching output format (spec v1.0 §8 — hard requirement).
//
// Not an encouragement coach. Every coaching statement is exactly
// one of: an observation (what the data shows), a benchmark (the
// best-practice reference), or an opinion labeled as opinion. No
// praise, no streaks, no guilt framing, no motivational copy. This
// module only formats; it cannot generate encouragement text.

export interface CoachingStatement {
  observation: string;
  benchmark: string | null;
  /** Always rendered with the "Opinion:" label. */
  opinion: string | null;
}

export function formatStatement(s: CoachingStatement): string {
  const parts = [s.observation];
  if (s.benchmark) parts.push(s.benchmark);
  if (s.opinion) parts.push(`Opinion: ${s.opinion}`);
  return parts.join(" ");
}

const BANNED_PATTERNS = [
  /great job/i,
  /well done/i,
  /keep it up/i,
  /you('ve| have) got this/i,
  /amazing/i,
  /awesome/i,
  /proud/i,
  /streak/i,
  /don'?t give up/i,
  /crush(ed|ing)? it/i,
];

/** Guard rail for §8: rejects motivational copy in any coaching
 *  text before it can be shown. */
export function assertCoachingVoice(text: string): void {
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`coaching voice violation: ${pattern} in "${text.slice(0, 60)}"`);
    }
  }
}
