import { COLLABORATION_STATES } from "../types";

/**
 * Human evaluation of system decisions (policy-v2-3 methodology). Raters label
 * pseudonymized discussion windows; agreement is reported as a confusion matrix,
 * raw percentage and Cohen's kappa. These are descriptive statistics for the
 * researcher, not a validation claim on their own.
 */

export const REVIEW_PROTOCOL_VERSION = "human-review-v1";

export const NECESSITY_LABELS = ["necessary", "unnecessary", "uncertain"] as const;
export const APPROPRIATENESS_LABELS = ["appropriate", "inappropriate", "unclear"] as const;
export const DISAGREEMENT_LABELS = ["productive_disagreement", "unproductive_conflict", "no_disagreement", "unclear"] as const;
export const STATE_LABELS = COLLABORATION_STATES;

export type NecessityLabel = (typeof NECESSITY_LABELS)[number];

export const REVIEW_TARGET_TYPES = ["evaluation", "intervention"] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export interface ConfusionMatrix {
  /** Row labels are the first rater (or the system); columns the second rater. */
  labels: string[];
  matrix: number[][];
  n: number;
}

export function confusionMatrix(pairs: [string, string][], labels?: readonly string[]): ConfusionMatrix {
  const all = labels ? [...labels] : [...new Set(pairs.flat())].sort();
  for (const [a, b] of pairs) {
    if (!all.includes(a)) all.push(a);
    if (!all.includes(b)) all.push(b);
  }
  const index = new Map(all.map((label, i) => [label, i]));
  const matrix = all.map(() => all.map(() => 0));
  for (const [a, b] of pairs) matrix[index.get(a)!][index.get(b)!] += 1;
  return { labels: all, matrix, n: pairs.length };
}

export function percentAgreement(pairs: [string, string][]): number | null {
  if (pairs.length === 0) return null;
  return pairs.filter(([a, b]) => a === b).length / pairs.length;
}

/** Cohen's kappa; null when there are no pairs or chance agreement is already 1 (undefined kappa). */
export function cohenKappa(pairs: [string, string][]): number | null {
  if (pairs.length === 0) return null;
  const { matrix, n } = confusionMatrix(pairs);
  const observed = matrix.reduce((sum, row, i) => sum + row[i], 0) / n;
  let expected = 0;
  for (let i = 0; i < matrix.length; i += 1) {
    const rowTotal = matrix[i].reduce((a, b) => a + b, 0);
    const colTotal = matrix.reduce((sum, row) => sum + row[i], 0);
    expected += (rowTotal / n) * (colTotal / n);
  }
  if (expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}

export interface AgreementSummary {
  n: number;
  percentAgreement: number | null;
  kappa: number | null;
  confusion: ConfusionMatrix;
}

export function summarizeAgreement(pairs: [string, string][], labels?: readonly string[]): AgreementSummary {
  return {
    n: pairs.length,
    percentAgreement: percentAgreement(pairs),
    kappa: cohenKappa(pairs),
    confusion: confusionMatrix(pairs, labels),
  };
}

/** What the system's own decision implies about necessity, for comparison with a rater's necessity label. */
export function systemNecessity(decisionAction: string | null | undefined): NecessityLabel {
  if (decisionAction === "offer" || decisionAction === "deliver") return "necessary";
  if (decisionAction === "no_action") return "unnecessary";
  return "uncertain";
}
