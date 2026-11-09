import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getScaffoldingOption, type ScaffoldingType } from "@/lib/types";
import { AdaptiveLearner, type LearnerRef } from "../adaptive/AdaptiveLearner";
import { ARM_LEVEL, isAdaptiveArm, type LearnerState } from "../adaptive/LearnerModel";
import { learnerStore, type LearnerModelStore, type ModelRef } from "../adaptive/LearnerModelStore";
import { isSupportAmountRating } from "../adaptive/rewards";
import type { MonitorResult } from "../CollaborationMonitor";
import { reportsOwnProgress } from "../GroupStateEstimator";
import { exposureService } from "../OfferExposureService";
import { outcomeEvaluator } from "../OutcomeEvaluator";
import { getPolicy, learningAwareOf, type LearningAwarePolicy, type LearningAwareRewards } from "../policies";
import { capabilitiesFor, conditionOf, type StudyAssignment } from "../ResearchConditionManager";
import type {
  CollaborationSnapshot,
  DifficultyResolved,
  EstimatedGroupState,
  LearningAwareMemberState,
  OutcomeValidity,
  ProgressFeedbackResponse,
  ScaffoldingMove,
  ScaffoldingTier,
} from "../types";
import type { LearningSignal } from "./BanditRewardPolicy";
import type { LearningAwareContext, LearningAwareDecision } from "./LearningAwarePrivateDecision";
import { currentTier, initialTier, transitionAfterHelp } from "./ScaffoldingState";

/**
 * policy-v2-3 counterpart of AdaptiveLearner. Reads what a member did from the
 * research tables (responses, exposures, one-click feedback, outcome
 * evaluations) and applies the reward-v2-3 rules once per event key. It also
 * keeps the member's scaffolding state and logs every private decision,
 * including "wait". Older policies keep using AdaptiveLearner unchanged.
 */

type InterventionRow = typeof schema.interventions.$inferSelect;

export interface LearningRef extends LearnerRef {
  rewards: LearningAwareRewards;
  la: LearningAwarePolicy;
}

const ACCEPTED = ["accepted", "delivered", "failed"];

function supportLevel(type: string): number {
  return getScaffoldingOption(type as ScaffoldingType)?.supportLevel ?? 0;
}

export class LearnerEvidenceAggregator extends AdaptiveLearner {
  constructor(private readonly models: LearnerModelStore = learnerStore) {
    super(models);
  }

  /** Null unless the group is proactive_adaptive on a policy-v2-3+ policy. */
  ref(assignment: StudyAssignment, participantId: string, now: string): LearningRef | null {
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const la = learningAwareOf(policy);
    if (!la || !policy.adaptivePrivate || !capabilitiesFor(conditionOf(assignment)).adaptivePrivate) return null;
    return {
      sessionId: assignment.sessionId,
      participantId,
      policyVersion: policy.version,
      policy: policy.adaptivePrivate,
      now,
      rewards: la.rewards,
      la,
    };
  }

  private modelRefOf(ref: LearningRef): ModelRef {
    return {
      sessionId: ref.sessionId,
      participantId: ref.participantId,
      policyVersion: ref.policyVersion,
      policy: ref.policy,
      now: ref.now,
      rewards: ref.rewards,
    };
  }

  private applySignal(
    ref: LearningRef,
    input: { scenarioOrder: number | null; eventKey: string; signal: LearningSignal | null; interventionId?: string | null; detail?: Record<string, unknown> }
  ) {
    return this.models.apply({ ...this.modelRefOf(ref), ...input });
  }

  private progressFeedback(interventionId: string, participantId: string): ProgressFeedbackResponse | null {
    return (
      (db
        .select({ response: schema.interventionProgressFeedback.response })
        .from(schema.interventionProgressFeedback)
        .where(
          and(
            eq(schema.interventionProgressFeedback.interventionId, interventionId),
            eq(schema.interventionProgressFeedback.participantId, participantId)
          )
        )
        .get()?.response as ProgressFeedbackResponse | undefined) ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Rewards
  // ---------------------------------------------------------------------------

  /** Applies every reward-v2-3 update that has become due for this member's popup offers. */
  override reconcile(ref: LearnerRef): void {
    const lref = ref as LearningRef;
    if (!lref.rewards) return super.reconcile(ref);
    const offers = this.adaptiveOffers(ref.sessionId, ref.participantId);
    if (offers.length === 0) return;
    const done = this.models.eventKeys(ref.participantId);
    for (const offer of offers) {
      if (!done.has(`response:${offer.id}`)) this.applyOfferResponse(lref, offer);
      if (offer.status === "failed" && !done.has(`outcome:${offer.id}`)) {
        this.applySignal(lref, {
          scenarioOrder: offer.scenarioOrder,
          eventKey: `outcome:${offer.id}`,
          signal: null,
          interventionId: offer.id,
          detail: { eventType: "help_outcome", skipped: "generation_failed", rewardVersion: lref.rewards.rewardVersion },
        });
      }
      if (offer.status !== "delivered" || !isAdaptiveArm(offer.supportType)) continue;
      const feedback = this.progressFeedback(offer.id, ref.participantId);
      if (feedback && !done.has(`feedback:${offer.id}`)) this.applyFeedback(lref, offer, feedback);
      if (!done.has(`outcome:${offer.id}`)) this.applyObservedOutcome(lref, offer);
    }
  }

  private applyOfferResponse(ref: LearningRef, offer: InterventionRow) {
    let signal: LearningSignal;
    if (ACCEPTED.includes(offer.status)) signal = { kind: "offer_response", response: "accepted" };
    else if (offer.status === "dismissed") signal = { kind: "offer_response", response: "dismissed" };
    else if (offer.status === "deferred") {
      const decision = this.models.decisionFor(offer.id);
      const pauseAtOffer = Number(decision?.evidence?.pauseSeconds);
      const deferredAt = offer.resolvedAt ?? ref.now;
      const pauseSeconds = Number.isFinite(pauseAtOffer)
        ? pauseAtOffer + Math.max(0, (Date.parse(deferredAt) - Date.parse(offer.createdAt)) / 1000)
        : null;
      signal = { kind: "offer_response", response: "deferred", pauseSeconds };
    } else if (offer.status === "expired") {
      signal = { kind: "offer_expired", seen: exposureService.wasSeenBy(offer.id, ref.participantId) };
    } else return;
    if (signal.kind !== "offer_response" || signal.response !== "accepted") this.models.resolveDeclined(offer.id, ref.now);
    this.applySignal(ref, {
      scenarioOrder: offer.scenarioOrder,
      eventKey: `response:${offer.id}`,
      signal,
      interventionId: offer.id,
    });
  }

  private applyFeedback(ref: LearningRef, offer: InterventionRow, response: ProgressFeedbackResponse) {
    if (!isAdaptiveArm(offer.supportType)) return;
    const result = this.applySignal(ref, {
      scenarioOrder: offer.scenarioOrder,
      eventKey: `feedback:${offer.id}`,
      signal: { kind: "progress_feedback", arm: offer.supportType, response },
      interventionId: offer.id,
    });
    const outcome = outcomeEvaluator.forIntervention(offer.id).find((o) => o.subjectKey === ref.participantId);
    if (outcome && result.changed) outcomeEvaluator.markApplied(outcome.id, outcome.learnerEventKey ?? `feedback:${offer.id}`, true);
    this.updateTier(ref, offer, { feedback: response === "skip" ? null : response, observedResolved: "unknown", validity: null });
  }

  /** Uses the stored outcome evaluation; explicit feedback (if any) already updated the arm. */
  private applyObservedOutcome(ref: LearningRef, offer: InterventionRow) {
    if (!isAdaptiveArm(offer.supportType)) return;
    const outcome = outcomeEvaluator.forIntervention(offer.id).find((o) => o.subjectKey === ref.participantId);
    if (!outcome) return;
    const fromFeedback = outcome.resolutionSource === "feedback";
    const eventKey = `outcome:${offer.id}`;
    const result = this.applySignal(ref, {
      scenarioOrder: offer.scenarioOrder,
      eventKey,
      signal: {
        kind: "observed_outcome",
        arm: offer.supportType,
        resolved: fromFeedback ? "unknown" : (outcome.difficultyResolved as DifficultyResolved),
        activityResumed: outcome.activityResumed,
        validity: outcome.validity as OutcomeValidity,
        wasVisible: outcome.wasVisible,
      },
      interventionId: offer.id,
      detail: {
        outcomeId: outcome.id,
        confounds: outcome.confounds,
        escalatedHelp: outcome.escalatedHelp,
        understandingEvidence: outcome.understandingEvidence,
        ...(fromFeedback ? { resolutionFromFeedbackAppliedSeparately: true } : {}),
      },
    });
    outcomeEvaluator.markApplied(outcome.id, eventKey, result.changed || outcome.updateApplied);
    if (!fromFeedback) {
      this.updateTier(ref, offer, {
        feedback: null,
        observedResolved: outcome.difficultyResolved as DifficultyResolved,
        validity: outcome.validity as OutcomeValidity,
      });
    }
  }

  /**
   * After submission: contributing without any AI help raises independence. Using
   * more direct help is recorded as observed higher support usage, nothing more.
   */
  override scenarioFinished(ref: LearnerRef, scenarioOrder: number): void {
    const lref = ref as LearningRef;
    if (!lref.rewards) return super.scenarioFinished(ref, scenarioOrder);
    this.reconcile(ref);
    const contributed = this.ownContributionTimes(ref.sessionId, ref.participantId, scenarioOrder).length > 0;
    const used = [
      ...this.stepTwoRows(ref.participantId, scenarioOrder).map((row) => row.scaffoldingType),
      ...this.adaptiveOffers(ref.sessionId, ref.participantId)
        .filter((offer) => offer.scenarioOrder === scenarioOrder && offer.status === "delivered")
        .map((offer) => offer.supportType),
    ];
    const maxLevel = Math.max(0, ...used.map(supportLevel));
    const outcome = contributed && used.length === 0 ? "independent" : maxLevel >= 2 ? "higher_support_used" : "neutral";
    this.applySignal(lref, {
      scenarioOrder,
      eventKey: `scenario:${scenarioOrder}`,
      signal: { kind: "scenario_outcome", outcome },
      detail: { contributed, usedSupportTypes: used, maxSupportLevel: maxLevel },
    });
  }

  override surveyRated(ref: LearnerRef, scenarioOrder: number, supportAmount: unknown): void {
    const lref = ref as LearningRef;
    if (!lref.rewards) return super.surveyRated(ref, scenarioOrder, supportAmount);
    if (!isSupportAmountRating(supportAmount)) return;
    this.applySignal(lref, {
      scenarioOrder,
      eventKey: `survey:${scenarioOrder}`,
      signal: { kind: "survey_rating", supportAmount },
    });
  }

  /** The member's own "I'm unsure", counted once per scenario. */
  selfReportedDifficulty(ref: LearningRef, scenarioOrder: number, messageId: string | null) {
    return this.applySignal(ref, {
      scenarioOrder,
      eventKey: `difficulty:${scenarioOrder}`,
      signal: { kind: "self_reported_difficulty" },
      detail: { messageId },
    });
  }

  // ---------------------------------------------------------------------------
  // Scaffolding state
  // ---------------------------------------------------------------------------

  private scaffoldingEvents(participantId: string, scenarioOrder: number) {
    return db
      .select()
      .from(schema.scaffoldingStateEvents)
      .where(
        and(
          eq(schema.scaffoldingStateEvents.participantId, participantId),
          eq(schema.scaffoldingStateEvents.scenarioOrder, scenarioOrder)
        )
      )
      .all();
  }

  /** Consecutive scenarios just before this one that the member managed without any AI help. */
  independentStreak(participantId: string, scenarioOrder: number): number {
    const outcomes = new Map(
      db
        .select({ order: schema.learnerModelEvents.scenarioOrder, detail: schema.learnerModelEvents.detail })
        .from(schema.learnerModelEvents)
        .where(
          and(
            eq(schema.learnerModelEvents.participantId, participantId),
            eq(schema.learnerModelEvents.eventType, "scenario_outcome"),
            lt(schema.learnerModelEvents.scenarioOrder, scenarioOrder)
          )
        )
        .all()
        .map((row) => [row.order, (row.detail as { outcome?: string }).outcome])
    );
    let streak = 0;
    for (let order = scenarioOrder - 1; order >= 1 && outcomes.get(order) === "independent"; order--) streak++;
    return streak;
  }

  private recordScaffolding(
    ref: LearningRef,
    input: {
      scenarioOrder: number;
      eventType: string;
      fromTier: ScaffoldingTier | null;
      toTier: ScaffoldingTier;
      move: ScaffoldingMove;
      reasonCode: string;
      interventionId?: string | null;
      detail?: Record<string, unknown>;
      eventKey: string;
    }
  ) {
    db.insert(schema.scaffoldingStateEvents)
      .values({
        sessionId: ref.sessionId,
        participantId: ref.participantId,
        scenarioOrder: input.scenarioOrder,
        policyVersion: ref.policyVersion,
        scaffoldingVersion: ref.la.scaffoldingVersion,
        eventType: input.eventType,
        fromTier: input.fromTier,
        toTier: input.toTier,
        move: input.move,
        reasonCode: input.reasonCode,
        interventionId: input.interventionId ?? null,
        detail: input.detail ?? {},
        eventKey: input.eventKey,
        createdAt: ref.now,
      })
      .onConflictDoNothing()
      .run();
  }

  /** The member's tier in this scenario; a faded start is recorded once with its evidence. */
  tierFor(ref: LearningRef, scenarioOrder: number): ScaffoldingTier {
    const events = this.scaffoldingEvents(ref.participantId, scenarioOrder).filter((e) => e.eventType !== "preference_stop");
    if (events.length > 0) return currentTier(events, "minimal");
    const streak = this.independentStreak(ref.participantId, scenarioOrder);
    const tier = initialTier(streak, ref.la.scaffolding.fadeAfterIndependentScenarios);
    if (tier === "no_offer") {
      this.recordScaffolding(ref, {
        scenarioOrder,
        eventType: "fading",
        fromTier: null,
        toTier: "no_offer",
        move: "fade",
        reasonCode: "independent_scenarios_before",
        detail: { independentStreak: streak, fadeAfter: ref.la.scaffolding.fadeAfterIndependentScenarios },
        eventKey: `fade_start:${scenarioOrder}`,
      });
    }
    return tier;
  }

  private updateTier(
    ref: LearningRef,
    offer: InterventionRow,
    evidence: { feedback: ProgressFeedbackResponse | null; observedResolved: DifficultyResolved; validity: OutcomeValidity | null }
  ) {
    if (!isAdaptiveArm(offer.supportType)) return;
    const from = this.tierFor(ref, offer.scenarioOrder);
    const transition = transitionAfterHelp(from, {
      level: ARM_LEVEL[offer.supportType],
      feedback: evidence.feedback === "skip" ? null : evidence.feedback,
      observedResolved: evidence.observedResolved,
      validity: evidence.validity,
    });
    if (!transition) return;
    this.recordScaffolding(ref, {
      scenarioOrder: offer.scenarioOrder,
      eventType: transition.eventType,
      fromTier: from,
      toTier: transition.toTier,
      move: transition.move,
      reasonCode: transition.reasonCode,
      interventionId: offer.id,
      detail: { supportType: offer.supportType, ...evidence },
      eventKey: `${transition.eventType}:${offer.id}`,
    });
  }

  isStopped(participantId: string, scenarioOrder: number): boolean {
    return this.scaffoldingEvents(participantId, scenarioOrder).some((e) => e.eventType === "preference_stop");
  }

  /** "Don't suggest again in this scenario": a hard stop for proactive popups, never for Step 2. */
  stopForScenario(ref: LearningRef, scenarioOrder: number, interventionId: string | null) {
    const tier = this.tierFor(ref, scenarioOrder);
    this.recordScaffolding(ref, {
      scenarioOrder,
      eventType: "preference_stop",
      fromTier: tier,
      toTier: tier,
      move: "remain_silent",
      reasonCode: "member_asked_for_no_more_suggestions",
      interventionId,
      eventKey: `stop:${scenarioOrder}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Decision input and trace
  // ---------------------------------------------------------------------------

  learningContext(input: {
    ref: LearningRef;
    snapshot: CollaborationSnapshot;
    monitor: MonitorResult;
    groupState: EstimatedGroupState | null;
    policyRecentWindowSeconds: number;
  }): LearningAwareContext {
    const { ref, snapshot } = input;
    const base = this.context({
      snapshot,
      participantId: ref.participantId,
      assessments: input.monitor.assessments,
      progressState: input.monitor.progress.state,
    });
    const own = snapshot.discussion
      .filter((m) => m.participantId === ref.participantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    const recent =
      !!own && Date.parse(snapshot.now) - Date.parse(own.createdAt) <= input.policyRecentWindowSeconds * 1000;
    return {
      ...base,
      tier: this.tierFor(ref, snapshot.scenarioOrder),
      stopped: this.isStopped(ref.participantId, snapshot.scenarioOrder),
      selfReportedProgress: recent && reportsOwnProgress(own!.text),
      groupState: input.groupState?.state ?? null,
      groupConfidence: input.groupState?.confidence ?? null,
    };
  }

  /** Every private decision for a connected member, collapsed while nothing changes. */
  logTrace(input: {
    ref: LearningRef;
    attemptId: string;
    scenarioOrder: number;
    decision: LearningAwareDecision;
    groupStateEstimateId: string | null;
    interventionId: string | null;
  }) {
    const { ref, decision } = input;
    const supportType = decision.action === "offer" ? decision.arm : null;
    const signature = [decision.action, decision.reasonCode, decision.tier, supportType ?? ""].join("|");
    db.transaction((tx) => {
      const latest = tx
        .select()
        .from(schema.privateDecisionTraces)
        .where(
          and(
            eq(schema.privateDecisionTraces.participantId, ref.participantId),
            eq(schema.privateDecisionTraces.attemptId, input.attemptId)
          )
        )
        .orderBy(desc(schema.privateDecisionTraces.decidedAt))
        .limit(1)
        .get();
      if (latest && latest.signature === signature && !input.interventionId) {
        tx.update(schema.privateDecisionTraces)
          .set({ repeatCount: latest.repeatCount + 1, lastRepeatedAt: ref.now })
          .where(eq(schema.privateDecisionTraces.id, latest.id))
          .run();
        return;
      }
      tx.insert(schema.privateDecisionTraces)
        .values({
          sessionId: ref.sessionId,
          attemptId: input.attemptId,
          scenarioOrder: input.scenarioOrder,
          participantId: ref.participantId,
          policyVersion: ref.policyVersion,
          modelVersion: ref.policy.modelVersion,
          rewardVersion: ref.rewards.rewardVersion,
          scaffoldingVersion: ref.la.scaffoldingVersion,
          action: decision.action,
          reasonCode: decision.reasonCode,
          tier: decision.tier,
          move: decision.move,
          supportType,
          evidence: (decision.evidence ?? {}) as unknown as Record<string, unknown>,
          groupStateEstimateId: input.groupStateEstimateId,
          interventionId: input.interventionId,
          signature,
          decidedAt: ref.now,
        })
        .run();
    });
  }

  /** Own progress feedback per intervention for this member and scenario (for their own client only). */
  ownProgressFeedback(participantId: string, scenarioOrder: number): Record<string, ProgressFeedbackResponse> {
    return Object.fromEntries(
      db
        .select({ interventionId: schema.interventionProgressFeedback.interventionId, response: schema.interventionProgressFeedback.response })
        .from(schema.interventionProgressFeedback)
        .where(
          and(
            eq(schema.interventionProgressFeedback.participantId, participantId),
            eq(schema.interventionProgressFeedback.scenarioOrder, scenarioOrder)
          )
        )
        .all()
        .map((row) => [row.interventionId, row.response as ProgressFeedbackResponse])
    );
  }

  /** Learner state read for tests and the dashboard. */
  stateOf(participantId: string): LearnerState | null {
    return this.models.get(participantId)?.state ?? null;
  }
}

export const learnerEvidence = new LearnerEvidenceAggregator();

/** What this member's own client may know about policy-v2-3 behaviour in this scenario; null on older policies. */
export function learningAwareMemberState(
  assignment: StudyAssignment,
  participantId: string | null,
  scenarioOrder: number
): LearningAwareMemberState | null {
  const la = learningAwareOf(getPolicy(assignment.interventionPolicyVersion));
  if (!la) return null;
  return {
    enabled: true,
    dismissal: la.groupOffers.dismissal,
    feedbackEnabled: la.feedback.enabled,
    feedbackDelaySeconds: la.feedback.promptDelaySeconds,
    proactiveStopped: participantId ? learnerEvidence.isStopped(participantId, scenarioOrder) : false,
    progressFeedback: participantId ? learnerEvidence.ownProgressFeedback(participantId, scenarioOrder) : {},
  };
}
