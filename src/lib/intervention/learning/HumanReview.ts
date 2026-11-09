import { createHash } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPolicy, hasPolicy } from "../policies";
import { EligibilityError } from "../ResearchEligibilityGuard";
import {
  APPROPRIATENESS_LABELS,
  DISAGREEMENT_LABELS,
  isOneOf,
  NECESSITY_LABELS,
  REVIEW_PROTOCOL_VERSION,
  REVIEW_TARGET_TYPES,
  STATE_LABELS,
  summarizeAgreement,
  systemNecessity,
} from "./ReviewAgreement";

/**
 * Researcher review of system decisions. Windows are pseudonymized (members are
 * "Member A/B/..." and their display names are masked inside messages) and, in
 * blind mode, carry no system decision or state so raters judge independently.
 * Sampling is deterministic (hash order) so a review set can be reproduced.
 */

export interface ReviewWindow {
  targetType: "evaluation" | "intervention";
  targetId: string;
  scenarioOrder: number;
  at: string;
  windowSeconds: number;
  messages: { speaker: string; text: string; at: string }[];
  system?: {
    decisionAction: string;
    reasonCode: string;
    trigger: string;
    supportType: string | null;
    estimatedState: string | null;
    estimatedConfidence: number | null;
    interventionId: string | null;
  };
}

const hashOrder = (id: string, salt: string) => createHash("sha256").update(`${salt}|${id}`).digest("hex");

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pseudonymizer(sessionId: string) {
  const participants = db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.sessionId, sessionId))
    .all()
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const labels = new Map(participants.map((p, i) => [p.id, `Member ${String.fromCharCode(65 + (i % 26))}`]));
  const names = participants
    .filter((p) => p.displayName.trim().length >= 2)
    .map((p) => ({ pattern: new RegExp(`\\b${escapeRegExp(p.displayName.trim())}\\b`, "gi"), label: labels.get(p.id)! }));
  return {
    speaker: (id: string | null) => (id ? (labels.get(id) ?? "Member ?") : "Former member"),
    mask: (text: string) => names.reduce((out, { pattern, label }) => out.replace(pattern, label), text),
  };
}

export function sampleReviewWindows(input: { sessionId: string; blind: boolean; limit: number; salt?: string }): ReviewWindow[] {
  const assignment = db
    .select()
    .from(schema.studyAssignments)
    .where(eq(schema.studyAssignments.sessionId, input.sessionId))
    .get();
  if (!assignment) return [];
  const policy = hasPolicy(assignment.interventionPolicyVersion) ? getPolicy(assignment.interventionPolicyVersion) : null;
  const windowSeconds = policy?.recentWindowSeconds ?? 240;
  const salt = input.salt ?? "review-v1";
  const evaluations = db
    .select()
    .from(schema.interventionEvaluations)
    .where(eq(schema.interventionEvaluations.sessionId, input.sessionId))
    .all()
    .filter((e) => !e.shadowOnly);
  const interventions = db
    .select()
    .from(schema.interventions)
    .where(eq(schema.interventions.sessionId, input.sessionId))
    .all();
  const interventionByEvaluation = new Map(interventions.filter((i) => i.evaluationId).map((i) => [i.evaluationId!, i]));
  const estimates = db
    .select()
    .from(schema.groupStateEstimates)
    .where(eq(schema.groupStateEstimates.sessionId, input.sessionId))
    .all();
  const estimateByEvaluation = new Map(estimates.filter((e) => e.evaluationId).map((e) => [e.evaluationId!, e]));

  // Half acted-on decisions, half decisions not to act, each in reproducible hash order.
  const ordered = (rows: typeof evaluations) => [...rows].sort((a, b) => hashOrder(a.id, salt).localeCompare(hashOrder(b.id, salt)));
  const acted = ordered(evaluations.filter((e) => e.decisionAction !== "no_action"));
  const waited = ordered(evaluations.filter((e) => e.decisionAction === "no_action"));
  const picked: typeof evaluations = [];
  while (picked.length < input.limit && (acted.length || waited.length)) {
    const next = (picked.length % 2 === 0 ? acted.shift() : waited.shift()) ?? acted.shift() ?? waited.shift();
    if (next) picked.push(next);
  }

  const { speaker, mask } = pseudonymizer(input.sessionId);
  const messages = db
    .select()
    .from(schema.discussionMessages)
    .where(eq(schema.discussionMessages.sessionId, input.sessionId))
    .all();
  return picked.map((evaluation) => {
    const end = Date.parse(evaluation.evaluatedAt);
    const start = end - windowSeconds * 1000;
    const intervention = interventionByEvaluation.get(evaluation.id) ?? null;
    const estimate = estimateByEvaluation.get(evaluation.id) ?? null;
    return {
      targetType: "evaluation" as const,
      targetId: evaluation.id,
      scenarioOrder: evaluation.scenarioOrder,
      at: evaluation.evaluatedAt,
      windowSeconds,
      messages: messages
        .filter((m) => m.scenarioOrder === evaluation.scenarioOrder)
        .filter((m) => {
          const at = Date.parse(m.createdAt);
          return at >= start && at <= end;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((m) => ({ speaker: speaker(m.participantId), text: mask(m.text), at: m.createdAt })),
      ...(input.blind
        ? {}
        : {
            system: {
              decisionAction: evaluation.decisionAction,
              reasonCode: evaluation.reasonCode,
              trigger: evaluation.trigger,
              supportType: evaluation.supportType,
              estimatedState: estimate?.state ?? null,
              estimatedConfidence: estimate?.confidence ?? null,
              interventionId: intervention?.id ?? null,
            },
          }),
    };
  });
}

export function saveReviewLabel(input: { sessionId: string; body: Record<string, unknown> }) {
  const { body } = input;
  if (!isOneOf(REVIEW_TARGET_TYPES, body.targetType)) throw new EligibilityError("Unknown target type", "invalid_target", 400);
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const raterId = typeof body.raterId === "string" ? body.raterId.trim().slice(0, 64) : "";
  if (!targetId || !raterId) throw new EligibilityError("targetId and raterId are required", "invalid_label", 400);
  if (!isOneOf(NECESSITY_LABELS, body.necessity)) throw new EligibilityError("Unknown necessity label", "invalid_label", 400);
  const optional = <T extends string>(values: readonly T[], value: unknown, name: string): T | null => {
    if (value === undefined || value === null || value === "") return null;
    if (!isOneOf(values, value)) throw new EligibilityError(`Unknown ${name} label`, "invalid_label", 400);
    return value;
  };
  const supportAppropriateness = optional(APPROPRIATENESS_LABELS, body.supportAppropriateness, "support appropriateness");
  const disagreementLabel = optional(DISAGREEMENT_LABELS, body.disagreementLabel, "disagreement");
  const stateLabel = optional(STATE_LABELS, body.stateLabel, "state");
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null;

  const target =
    body.targetType === "evaluation"
      ? db
          .select({ scenarioOrder: schema.interventionEvaluations.scenarioOrder, attemptId: schema.interventionEvaluations.attemptId })
          .from(schema.interventionEvaluations)
          .where(and(eq(schema.interventionEvaluations.id, targetId), eq(schema.interventionEvaluations.sessionId, input.sessionId)))
          .get()
      : db
          .select({ scenarioOrder: schema.interventions.scenarioOrder, attemptId: schema.interventions.attemptId })
          .from(schema.interventions)
          .where(and(eq(schema.interventions.id, targetId), eq(schema.interventions.sessionId, input.sessionId)))
          .get();
  if (!target) throw new EligibilityError("Target not found in this group", "not_found", 404);

  const now = new Date().toISOString();
  const values = {
    sessionId: input.sessionId,
    attemptId: target.attemptId,
    scenarioOrder: target.scenarioOrder,
    targetType: body.targetType,
    targetId,
    raterId,
    blind: body.blind !== false,
    necessity: body.necessity,
    supportAppropriateness,
    disagreementLabel,
    stateLabel,
    notes,
    reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
    updatedAt: now,
  };
  return db
    .insert(schema.humanReviewLabels)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.humanReviewLabels.targetType, schema.humanReviewLabels.targetId, schema.humanReviewLabels.raterId],
      set: {
        blind: values.blind,
        necessity: values.necessity,
        supportAppropriateness,
        disagreementLabel,
        stateLabel,
        notes,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}

/** System-vs-human and human-vs-human agreement for the given groups. */
export function reviewAgreement(sessionIds: string[]) {
  if (sessionIds.length === 0) sessionIds = ["-"];
  const labels = db.select().from(schema.humanReviewLabels).where(inArray(schema.humanReviewLabels.sessionId, sessionIds)).all();
  const evaluations = new Map(
    db
      .select()
      .from(schema.interventionEvaluations)
      .where(inArray(schema.interventionEvaluations.sessionId, sessionIds))
      .all()
      .map((e) => [e.id, e])
  );
  const interventions = new Map(
    db
      .select()
      .from(schema.interventions)
      .where(inArray(schema.interventions.sessionId, sessionIds))
      .all()
      .map((i) => [i.id, i])
  );
  const estimateByEvaluation = new Map(
    db
      .select()
      .from(schema.groupStateEstimates)
      .where(inArray(schema.groupStateEstimates.sessionId, sessionIds))
      .all()
      .filter((e) => e.evaluationId)
      .sort((a, b) => a.estimatedAt.localeCompare(b.estimatedAt))
      .map((e) => [e.evaluationId!, e])
  );
  const evaluationOf = (label: (typeof labels)[number]) =>
    label.targetType === "evaluation" ? label.targetId : (interventions.get(label.targetId)?.evaluationId ?? null);

  const systemNecessityPairs: [string, string][] = [];
  const systemStatePairs: [string, string][] = [];
  for (const label of labels) {
    const evaluationId = evaluationOf(label);
    const evaluation = evaluationId ? evaluations.get(evaluationId) : undefined;
    if (evaluation) systemNecessityPairs.push([systemNecessity(evaluation.decisionAction), label.necessity]);
    const estimate = evaluationId ? estimateByEvaluation.get(evaluationId) : undefined;
    if (estimate && label.stateLabel) systemStatePairs.push([estimate.state, label.stateLabel]);
  }

  const byTarget = new Map<string, typeof labels>();
  for (const label of labels) {
    const key = `${label.targetType}:${label.targetId}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), label]);
  }
  const humanPairs = { necessity: [] as [string, string][], state: [] as [string, string][], disagreement: [] as [string, string][] };
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    const [first, second] = [...group].sort((a, b) => a.raterId.localeCompare(b.raterId));
    humanPairs.necessity.push([first.necessity, second.necessity]);
    if (first.stateLabel && second.stateLabel) humanPairs.state.push([first.stateLabel, second.stateLabel]);
    if (first.disagreementLabel && second.disagreementLabel) {
      humanPairs.disagreement.push([first.disagreementLabel, second.disagreementLabel]);
    }
  }

  return {
    reviewProtocolVersion: REVIEW_PROTOCOL_VERSION,
    labels: labels.length,
    systemVsHuman: {
      necessity: summarizeAgreement(systemNecessityPairs, NECESSITY_LABELS),
      state: summarizeAgreement(systemStatePairs, STATE_LABELS),
    },
    humanVsHuman: {
      necessity: summarizeAgreement(humanPairs.necessity, NECESSITY_LABELS),
      state: summarizeAgreement(humanPairs.state, STATE_LABELS),
      disagreement: summarizeAgreement(humanPairs.disagreement, DISAGREEMENT_LABELS),
    },
  };
}
