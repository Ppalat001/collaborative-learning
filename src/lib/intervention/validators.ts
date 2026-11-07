/**
 * Output checks for model-generated content. Anything that fails is discarded and
 * the system takes the safe path (no intervention, or a logged failure).
 */

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface ClassifierOutput {
  label: "unresolved_disagreement" | "productive_disagreement" | "none";
  evidenceMessageIds: string[];
  confidence: number;
}

const CLASSIFIER_LABELS = new Set(["unresolved_disagreement", "productive_disagreement", "none"]);

/** Accepts an object or a JSON string; evidence ids must come from the transcript sent. */
export function validateClassifierOutput(
  raw: unknown,
  knownMessageIds: Set<string>
): Validation<ClassifierOutput> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, reason: "not JSON" };
    }
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "not an object" };
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || !CLASSIFIER_LABELS.has(record.label)) {
    return { ok: false, reason: "unknown label" };
  }
  if (typeof record.confidence !== "number" || !(record.confidence >= 0 && record.confidence <= 1)) {
    return { ok: false, reason: "confidence out of range" };
  }
  const ids = record.evidenceMessageIds ?? [];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    return { ok: false, reason: "evidence ids malformed" };
  }
  if (ids.some((id) => !knownMessageIds.has(id))) {
    return { ok: false, reason: "evidence id not in transcript" };
  }
  return {
    ok: true,
    value: {
      label: record.label as ClassifierOutput["label"],
      evidenceMessageIds: ids as string[],
      confidence: record.confidence,
    },
  };
}

/** Phrases that indicate the facilitator is handing over an answer rather than facilitating. */
const ANSWER_GIVING = [
  /\bthe (correct|right|best|model|final) answer (is|would be|should be)\b/i,
  /\byour (group'?s )?(answer|recommendation) should (be|say|state)\b/i,
  /\bhere(?:'s| is) (a|the|your) (model|complete|full|final|suggested) answer\b/i,
  /\byou should (write|answer|conclude)\b/i,
  /\bthe solution is\b/i,
];

/** Statements that evaluate or single out a member (tone/participation judgements). */
const SINGLING_OUT = [
  /\bmember [a-d]\b/i,
  /\b(hasn'?t|has not|haven'?t|have not) (said|contributed|participated|spoken)\b/i,
  /\b(quiet|silent) (member|one|student)s?\b/i,
  /\b(dominat|talking too much)\w*/i,
];

export function validateFacilitatorOutput(
  text: string,
  options: { maxChars: number; memberNames?: string[] }
): Validation<string> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty output" };
  if (trimmed.length > options.maxChars) return { ok: false, reason: "output too long" };
  if (ANSWER_GIVING.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: "output appears to give the answer" };
  }
  if (SINGLING_OUT.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: "output singles out or evaluates a member" };
  }
  for (const name of options.memberNames ?? []) {
    const clean = name.trim();
    if (clean.length >= 2 && new RegExp(`\\b${escapeRegExp(clean)}\\b`, "i").test(trimmed)) {
      return { ok: false, reason: "output names a member" };
    }
  }
  return { ok: true, value: trimmed };
}

/** Private minimal help (hint/guiding question) must not hand over the answer either. */
export function validatePrivateOfferOutput(text: string, maxChars: number): Validation<string> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty output" };
  if (trimmed.length > maxChars) return { ok: false, reason: "output too long" };
  if (ANSWER_GIVING.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: "output appears to give the answer" };
  }
  return { ok: true, value: trimmed };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
