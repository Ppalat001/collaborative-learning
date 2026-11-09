/**
 * Optional researcher rubric for the written pre/post question 9. Off unless
 * ADAPTIVE_V2_OPEN_ANSWER_RUBRIC=true. It is stored in its own table and is never
 * added to, or allowed to change, the 0-8 multiple-choice score or the question.
 */

export const OPEN_RUBRIC_VERSION = "open-application-rubric-v1";
export const OPEN_RUBRIC_QUESTION_ID = "open_ai_role";

export const OPEN_RUBRIC_CRITERIA = [
  {
    key: "recognizes_difficulty",
    label: "Recognises the group's difficulty (repeating the same arguments without progress)",
  },
  {
    key: "appropriate_ai_scope",
    label: "Describes an appropriate AI scope and action (e.g. a question, prompt or hint, not the full answer)",
  },
  {
    key: "justified_timing",
    label: "Justifies who should receive the support and when",
  },
  {
    key: "preserves_autonomy",
    label: "Keeps the group responsible for the solution",
  },
] as const;

export type OpenRubricKey = (typeof OPEN_RUBRIC_CRITERIA)[number]["key"];

export function isOpenRubricEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADAPTIVE_V2_OPEN_ANSWER_RUBRIC?.trim().toLowerCase() === "true";
}

/** Each criterion is 0 or 1; the total is 0-4. */
export function scoreOpenRubric(
  input: unknown
): { ok: true; criteria: Record<OpenRubricKey, 0 | 1>; total: number } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "criteria must be an object" };
  const raw = input as Record<string, unknown>;
  const criteria = {} as Record<OpenRubricKey, 0 | 1>;
  for (const { key } of OPEN_RUBRIC_CRITERIA) {
    const value = raw[key];
    if (value !== 0 && value !== 1) return { ok: false, error: `${key} must be 0 or 1` };
    criteria[key] = value;
  }
  const unknown = Object.keys(raw).filter((key) => !OPEN_RUBRIC_CRITERIA.some((c) => c.key === key));
  if (unknown.length) return { ok: false, error: `Unknown criteria: ${unknown.join(", ")}` };
  return { ok: true, criteria, total: Object.values(criteria).reduce<number>((sum, v) => sum + v, 0) };
}
