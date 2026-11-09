import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getScaffoldingOption, type ScaffoldingType } from "@/lib/types";
import { ADAPTIVE_REASON_CODE } from "./adaptive/AdaptiveLearner";
import { learnerStore } from "./adaptive/LearnerModelStore";
import { hasReasoning, isAgreement, isConfusion } from "./CollaborationMonitor";
import { contentTokens } from "./GroupStateEstimator";
import { exposureService } from "./OfferExposureService";
import { learningAwareOf, type InterventionPolicy } from "./policies";
import type {
  DifficultyResolved,
  DiscussionEntry,
  EvidenceRef,
  ObservedOutcome,
  OutcomeValidity,
  ProgressFeedbackResponse,
} from "./types";

/**
 * What can be observed after delivered proactive support (policy-v2-3+), kept
 * in separate fields: did activity resume, did the observable obstacle seem to
 * resolve, what did members say, was it seen, what confounds were present.
 * Understanding is never inferred here ("not_assessed"). Missing evidence gives
 * "insufficient_evidence", and confounded windows are labelled as such, so the
 * learner never receives a negative update just because nothing was observed.
 * These are observational associations, not causal effects.
 */

const SUBSTANTIVE_EDIT_CHARS = 10;

export interface OutcomeInput {
  intervention: {
    id: string;
    scope: "group" | "individual";
    trigger: string;
    supportType: string;
    deliveredAt: string;
    recipientParticipantId: string | null;
  };
  /** "group" or the recipient's participant id. */
  subject: string;
  /** Directness of the delivered help (1 minimal, 2 moderate); process prompts are 0. */
  helpLevel: number;
  /** Private help that answered the member's own explicit "I'm unsure". */
  ownConfusionAtOffer: boolean;
  activeParticipantIds: string[];
  windowSeconds: number;
  confoundWindowSeconds: number;
  submittedAt: string | null;
  messages: DiscussionEntry[];
  edits: { id: string; participantId: string | null; at: string; charsAdded: number; charsRemoved: number }[];
  stepTwo: { id: string; participantId: string; level: number; at: string }[];
  otherInterventions: { id: string; scope: string; recipientParticipantId: string | null; deliveredAt: string }[];
  feedback: { id: string; participantId: string; response: ProgressFeedbackResponse; at: string }[];
  seenBy: string[];
  evaluatorVersion: string;
}

const addSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

export function feedbackResolution(responses: ProgressFeedbackResponse[]): DifficultyResolved | null {
  const real = responses.filter((r) => r !== "skip" && r !== "not_needed");
  if (real.length === 0) return null;
  const yes = real.filter((r) => r === "yes").length;
  const no = real.filter((r) => r === "no").length;
  if (yes === real.length) return "yes";
  if (no === real.length) return "no";
  return "partly";
}

export function evaluateOutcome(input: OutcomeInput): ObservedOutcome {
  const { intervention } = input;
  const start = intervention.deliveredAt;
  const nominalEnd = addSeconds(start, input.windowSeconds);
  const truncated = !!input.submittedAt && input.submittedAt < nominalEnd;
  const end = truncated ? input.submittedAt! : nominalEnd;
  const inWindow = (at: string) => at > start && at <= end;
  const isGroup = input.subject === "group";
  const mine = (participantId: string | null) => isGroup || participantId === input.subject;

  const messages = input.messages
    .filter((m) => inWindow(m.createdAt) && mine(m.participantId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const edits = input.edits.filter(
    (e) => inWindow(e.at) && mine(e.participantId) && e.charsAdded + e.charsRemoved >= SUBSTANTIVE_EDIT_CHARS
  );
  const stepTwo = input.stepTwo.filter((s) => inWindow(s.at) && mine(s.participantId));
  const feedback = input.feedback.filter((f) => mine(f.participantId) && input.activeParticipantIds.includes(f.participantId));

  const activityResumed = messages.length > 0 || edits.length > 0 ? true : truncated ? null : false;
  const reasoned = (m: DiscussionEntry) => hasReasoning(m.text) && contentTokens(m.text).size >= 3;

  // Observable obstacle only; never "understanding".
  let observed: DifficultyResolved = "unknown";
  if (isGroup) {
    const speakers = new Set(messages.map((m) => m.participantId));
    switch (intervention.trigger) {
      case "unresolved_disagreement":
        if (messages.some((m) => isAgreement(m.text))) observed = "yes";
        break;
      case "initial_silence":
      case "stalled_discussion":
        if (speakers.size >= 2) observed = "yes";
        else if (activityResumed === false) observed = "no";
        break;
      case "explicit_confusion": {
        const lastConfusion = messages.filter((m) => isConfusion(m.text)).at(-1);
        const reasonedAfter = messages.some((m) => reasoned(m) && (!lastConfusion || m.createdAt > lastConfusion.createdAt));
        if (lastConfusion && !reasonedAfter) observed = "no";
        else if (reasonedAfter && !lastConfusion) observed = "yes";
        break;
      }
      case "possible_participation_imbalance":
        if (input.activeParticipantIds.every((id) => speakers.has(id))) observed = "yes";
        break;
    }
  } else {
    const lastConfusion = messages.filter((m) => isConfusion(m.text)).at(-1);
    const reasonedAfter = messages.some((m) => reasoned(m) && (!lastConfusion || m.createdAt > lastConfusion.createdAt));
    if (lastConfusion && !reasonedAfter) observed = "no";
    else if (input.ownConfusionAtOffer && reasonedAfter && !lastConfusion) observed = "yes";
  }

  const fromFeedback = feedbackResolution(feedback.map((f) => f.response));
  const difficultyResolved = fromFeedback ?? observed;
  const resolutionSource = fromFeedback ? "feedback" : observed !== "unknown" ? "observation" : "none";
  const ownFeedback = isGroup ? null : (feedback.find((f) => f.participantId === input.subject)?.response ?? null);

  const escalatedHelp = !isGroup && stepTwo.some((s) => s.level > input.helpLevel);
  const confoundFrom = addSeconds(start, -input.confoundWindowSeconds);
  const nearby = input.otherInterventions.filter(
    (o) =>
      o.id !== intervention.id &&
      o.deliveredAt > confoundFrom &&
      o.deliveredAt <= end &&
      (o.scope === "group" || isGroup || o.recipientParticipantId === input.subject)
  );
  const wasVisible = isGroup
    ? input.seenBy.length > 0
      ? true
      : null
    : input.seenBy.includes(input.subject)
      ? true
      : null;

  const confounds: string[] = [];
  if (escalatedHelp) confounds.push("escalated_help");
  if (stepTwo.length > 0) confounds.push("step_two_used_in_window");
  if (nearby.length > 0) confounds.push("other_intervention_nearby");
  if (truncated) confounds.push("submitted_during_window");
  if (wasVisible !== true) confounds.push("offer_not_seen");

  let validity: OutcomeValidity;
  if (wasVisible !== true) validity = "insufficient_evidence";
  else if (resolutionSource === "feedback") validity = "usable";
  else if (stepTwo.length > 0 || nearby.length > 0) validity = "confounded";
  else if (difficultyResolved === "unknown" && activityResumed === null) validity = "insufficient_evidence";
  else validity = "usable";

  const provenance: EvidenceRef[] = [
    ...messages.map((m): EvidenceRef => ({ id: m.id, kind: "message", at: m.createdAt })),
    ...edits.map((e): EvidenceRef => ({ id: e.id, kind: "edit", at: e.at })),
    ...feedback.map((f): EvidenceRef => ({ id: f.id, kind: "post_intervention_progress", at: f.at })),
    ...stepTwo.map((s): EvidenceRef => ({ id: s.id, kind: "support_request", at: s.at })),
  ].slice(0, 30);

  return {
    interventionId: intervention.id,
    subject: input.subject,
    windowStart: start,
    windowEnd: end,
    activityResumed,
    difficultyResolved,
    resolutionSource,
    understandingEvidence: "not_assessed",
    participantFeedback: ownFeedback === "skip" ? null : ownFeedback,
    wasVisible,
    escalatedHelp,
    confounds,
    validity,
    provenance,
    evaluatorVersion: input.evaluatorVersion,
  };
}

type OutcomeRow = typeof schema.interventionOutcomeEvaluations.$inferSelect;
type InterventionRow = typeof schema.interventions.$inferSelect;

function helpLevel(supportType: string): number {
  return getScaffoldingOption(supportType as ScaffoldingType)?.supportLevel ?? 0;
}

/** Which delivered interventions get an outcome evaluation, and for whom. */
export function outcomeSubjects(row: InterventionRow): string[] {
  if (row.status !== "delivered" || !row.deliveredAt) return [];
  if (row.scope === "individual" && row.reasonCode === ADAPTIVE_REASON_CODE && row.recipientParticipantId) {
    return [row.recipientParticipantId];
  }
  if (row.scope === "group" && row.initiatedBy === "system") return ["group"];
  return [];
}

export class OutcomeEvaluatorService {
  private gather(sessionId: string, scenarioOrder: number) {
    const messages = db
      .select()
      .from(schema.discussionMessages)
      .where(and(eq(schema.discussionMessages.sessionId, sessionId), eq(schema.discussionMessages.scenarioOrder, scenarioOrder)))
      .all()
      .filter((m) => m.participantId)
      .map((m): DiscussionEntry => ({ id: m.id, participantId: m.participantId!, text: m.text, createdAt: m.createdAt }));
    const edits = db
      .select()
      .from(schema.editEvents)
      .where(
        and(
          eq(schema.editEvents.sessionId, sessionId),
          eq(schema.editEvents.scenarioOrder, scenarioOrder),
          eq(schema.editEvents.field, "finalAnswer")
        )
      )
      .all()
      .map((e) => ({ id: e.id, participantId: e.participantId, at: e.createdAt, charsAdded: e.charsAdded, charsRemoved: e.charsRemoved }));
    const stepTwo = db
      .select()
      .from(schema.individualScaffolds)
      .where(and(eq(schema.individualScaffolds.sessionId, sessionId), eq(schema.individualScaffolds.scenarioOrder, scenarioOrder)))
      .all()
      .flatMap((s) => {
        const level = helpLevel(s.scaffoldingType);
        const times = [s.createdAt, ...(s.selected && s.lastToggledAt !== s.createdAt ? [s.lastToggledAt] : [])];
        return times.map((at, i) => ({ id: `${s.id}${i ? `:${i}` : ""}`, participantId: s.participantId, level, at }));
      });
    return { messages, edits, stepTwo };
  }

  private feedbackFor(interventionId: string) {
    return db
      .select()
      .from(schema.interventionProgressFeedback)
      .where(eq(schema.interventionProgressFeedback.interventionId, interventionId))
      .all()
      .map((f) => ({ id: f.id, participantId: f.participantId, response: f.response as ProgressFeedbackResponse, at: f.createdAt }));
  }

  private compute(
    row: InterventionRow,
    subject: string,
    policy: InterventionPolicy,
    activeParticipantIds: string[],
    submittedAt: string | null,
    data: ReturnType<OutcomeEvaluatorService["gather"]>,
    delivered: InterventionRow[]
  ): ObservedOutcome {
    const la = learningAwareOf(policy)!;
    const decision = row.scope === "individual" ? learnerStore.decisionFor(row.id) : null;
    return evaluateOutcome({
      intervention: {
        id: row.id,
        scope: row.scope as "group" | "individual",
        trigger: row.trigger,
        supportType: row.supportType,
        deliveredAt: row.deliveredAt!,
        recipientParticipantId: row.recipientParticipantId,
      },
      subject,
      helpLevel: row.scope === "individual" ? helpLevel(row.supportType) : 0,
      ownConfusionAtOffer: Boolean((decision?.evidence as { ownConfusion?: boolean } | undefined)?.ownConfusion),
      activeParticipantIds,
      windowSeconds: la.outcome.windowSeconds,
      confoundWindowSeconds: la.outcome.confoundWindowSeconds,
      submittedAt,
      ...data,
      otherInterventions: delivered
        .filter((d) => d.deliveredAt)
        .map((d) => ({ id: d.id, scope: d.scope, recipientParticipantId: d.recipientParticipantId, deliveredAt: d.deliveredAt! })),
      feedback: this.feedbackFor(row.id),
      seenBy: exposureService.seenBy(row.id),
      evaluatorVersion: la.evaluatorVersion,
    });
  }

  /**
   * Evaluates every delivered proactive intervention of the attempt whose window
   * has closed (or all of them once the scenario is submitted). Idempotent.
   */
  evaluateDue(input: {
    sessionId: string;
    attemptId: string;
    scenarioOrder: number;
    policy: InterventionPolicy;
    activeParticipantIds: string[];
    now: string;
    submittedAt: string | null;
  }): OutcomeRow[] {
    const la = learningAwareOf(input.policy);
    if (!la) return [];
    const delivered = db
      .select()
      .from(schema.interventions)
      .where(and(eq(schema.interventions.attemptId, input.attemptId), eq(schema.interventions.status, "delivered")))
      .all();
    const candidates = delivered.filter((row) => outcomeSubjects(row).length > 0);
    if (candidates.length === 0) return [];
    const existing = new Set(
      db
        .select({ interventionId: schema.interventionOutcomeEvaluations.interventionId, subject: schema.interventionOutcomeEvaluations.subjectKey })
        .from(schema.interventionOutcomeEvaluations)
        .where(inArray(schema.interventionOutcomeEvaluations.interventionId, candidates.map((c) => c.id)))
        .all()
        .map((r) => `${r.interventionId}:${r.subject}`)
    );
    let data: ReturnType<OutcomeEvaluatorService["gather"]> | null = null;
    const created: OutcomeRow[] = [];
    for (const row of candidates) {
      const due = !!input.submittedAt || input.now >= addSeconds(row.deliveredAt!, la.outcome.windowSeconds);
      if (!due) continue;
      for (const subject of outcomeSubjects(row)) {
        if (existing.has(`${row.id}:${subject}`)) continue;
        data ??= this.gather(input.sessionId, input.scenarioOrder);
        const outcome = this.compute(row, subject, input.policy, input.activeParticipantIds, input.submittedAt, data, delivered);
        const inserted = db
          .insert(schema.interventionOutcomeEvaluations)
          .values({
            sessionId: input.sessionId,
            interventionId: row.id,
            subjectKey: subject,
            participantId: subject === "group" ? null : subject,
            scenarioOrder: row.scenarioOrder,
            scope: row.scope,
            windowStart: outcome.windowStart,
            windowEnd: outcome.windowEnd,
            activityResumed: outcome.activityResumed,
            difficultyResolved: outcome.difficultyResolved,
            resolutionSource: outcome.resolutionSource,
            understandingEvidence: outcome.understandingEvidence,
            participantFeedback: outcome.participantFeedback,
            wasVisible: outcome.wasVisible,
            escalatedHelp: outcome.escalatedHelp,
            confounds: outcome.confounds,
            validity: outcome.validity,
            provenance: outcome.provenance,
            evaluatorVersion: outcome.evaluatorVersion,
            rewardVersion: subject === "group" ? null : la.rewards.rewardVersion,
            policyVersion: row.policyVersion,
            evaluatedAt: input.now,
          })
          .onConflictDoNothing()
          .returning()
          .get();
        if (inserted) created.push(inserted);
      }
    }
    return created;
  }

  /** Feedback that arrives after the window closed amends the stored outcome (kept auditable via amended_at). */
  amendWithFeedback(interventionId: string, subject: string, policy: InterventionPolicy, activeParticipantIds: string[], now: string) {
    const row = db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(
        and(
          eq(schema.interventionOutcomeEvaluations.interventionId, interventionId),
          eq(schema.interventionOutcomeEvaluations.subjectKey, subject)
        )
      )
      .get();
    if (!row || !learningAwareOf(policy)) return null;
    const feedback = this.feedbackFor(interventionId).filter(
      (f) => (subject === "group" || f.participantId === subject) && activeParticipantIds.includes(f.participantId)
    );
    const fromFeedback = feedbackResolution(feedback.map((f) => f.response));
    const own = subject === "group" ? null : (feedback.find((f) => f.participantId === subject)?.response ?? null);
    const provenance = [
      ...row.provenance.filter((r) => r.kind !== "post_intervention_progress"),
      ...feedback.map((f): EvidenceRef => ({ id: f.id, kind: "post_intervention_progress", at: f.at })),
    ];
    return (
      db
        .update(schema.interventionOutcomeEvaluations)
        .set({
          participantFeedback: own === "skip" ? null : own,
          ...(fromFeedback
            ? { difficultyResolved: fromFeedback, resolutionSource: "feedback", validity: row.wasVisible ? "usable" : row.validity }
            : {}),
          provenance,
          amendedAt: now,
        })
        .where(eq(schema.interventionOutcomeEvaluations.id, row.id))
        .returning()
        .get() ?? null
    );
  }

  forIntervention(interventionId: string): OutcomeRow[] {
    return db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(eq(schema.interventionOutcomeEvaluations.interventionId, interventionId))
      .all();
  }

  markApplied(id: string, learnerEventKey: string, updateApplied: boolean) {
    db.update(schema.interventionOutcomeEvaluations)
      .set({ learnerEventKey, updateApplied })
      .where(eq(schema.interventionOutcomeEvaluations.id, id))
      .run();
  }
}

export const outcomeEvaluator = new OutcomeEvaluatorService();
