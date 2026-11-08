import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getScaffoldingOption, type ScaffoldingType } from "@/lib/types";
import { isConfusion } from "../CollaborationMonitor";
import type { AdaptivePrivatePolicy } from "../policies";
import type { CollaborationSnapshot, InterventionAssessment, ProgressState } from "../types";
import type { AdaptiveContext } from "./AdaptivePrivatePolicy";
import { ARM_LEVEL, isAdaptiveArm, type LearnerState } from "./LearnerModel";
import { learnerStore, type LearnerModelStore, type ModelRef } from "./LearnerModelStore";
import { isSupportAmountRating, type OfferResponse, type ScenarioOutcome } from "./rewards";

/**
 * Reads what a member did from the research tables and feeds it to their learner
 * model. Every reward is derived from persisted rows and applied once per event
 * key, so calling these methods repeatedly (scheduler, responses, submission) is safe.
 */

export const ADAPTIVE_REASON_CODE = "adaptive_private";

type InterventionRow = typeof schema.interventions.$inferSelect;

const PENDING = ["suggested", "accepted"];
const ACCEPTED = ["accepted", "delivered", "failed"];

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function supportLevel(type: string): number {
  return getScaffoldingOption(type as ScaffoldingType)?.supportLevel ?? 0;
}

export interface LearnerRef {
  sessionId: string;
  participantId: string;
  policyVersion: string;
  policy: AdaptivePrivatePolicy;
  now: string;
}

export class AdaptiveLearner {
  constructor(private readonly store: LearnerModelStore = learnerStore) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  ownContributionTimes(sessionId: string, participantId: string, scenarioOrder: number): string[] {
    const messages = db
      .select({ at: schema.discussionMessages.createdAt })
      .from(schema.discussionMessages)
      .where(
        and(
          eq(schema.discussionMessages.sessionId, sessionId),
          eq(schema.discussionMessages.participantId, participantId),
          eq(schema.discussionMessages.scenarioOrder, scenarioOrder)
        )
      )
      .all();
    const edits = db
      .select({ at: schema.editEvents.createdAt })
      .from(schema.editEvents)
      .where(
        and(
          eq(schema.editEvents.sessionId, sessionId),
          eq(schema.editEvents.participantId, participantId),
          eq(schema.editEvents.scenarioOrder, scenarioOrder)
        )
      )
      .all();
    return [...messages, ...edits].map((row) => row.at).sort();
  }

  private stepTwoRows(participantId: string, scenarioOrder: number) {
    return db
      .select()
      .from(schema.individualScaffolds)
      .where(
        and(
          eq(schema.individualScaffolds.participantId, participantId),
          eq(schema.individualScaffolds.scenarioOrder, scenarioOrder)
        )
      )
      .all();
  }

  adaptiveOffers(sessionId: string, participantId: string): InterventionRow[] {
    return db
      .select()
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.sessionId, sessionId),
          eq(schema.interventions.recipientParticipantId, participantId),
          eq(schema.interventions.reasonCode, ADAPTIVE_REASON_CODE)
        )
      )
      .all();
  }

  // ---------------------------------------------------------------------------
  // Decision input
  // ---------------------------------------------------------------------------

  /** Folds new contributions into the pace estimate; returns the up-to-date state. */
  syncPace(ref: LearnerRef, scenarioOrder: number): LearnerState {
    return this.store.observeContributions({
      ...ref,
      scenarioOrder,
      times: this.ownContributionTimes(ref.sessionId, ref.participantId, scenarioOrder),
    });
  }

  context(input: {
    snapshot: CollaborationSnapshot;
    participantId: string;
    assessments: InterventionAssessment[];
    progressState: ProgressState;
  }): AdaptiveContext {
    const { snapshot, participantId } = input;
    const order = snapshot.scenarioOrder;
    const offers = this.adaptiveOffers(snapshot.sessionId, participantId).filter(
      (offer) => offer.attemptId === snapshot.scenarioAttemptId
    );
    const stepTwo = this.stepTwoRows(participantId, order);
    const usedTypes = new Set<string>([
      ...stepTwo.map((row) => row.scaffoldingType),
      ...offers.filter((offer) => offer.status === "delivered").map((offer) => offer.supportType),
    ]);
    return {
      participantId,
      scenarioOrder: order,
      now: snapshot.now,
      online: snapshot.onlineParticipantIds.includes(participantId),
      submitted: snapshot.submitted,
      scenarioStartedAt: snapshot.startedAt,
      lastOwnContributionAt: this.ownContributionTimes(snapshot.sessionId, participantId, order).at(-1) ?? null,
      ownConfusion: input.assessments.some(
        (a) => a.trigger === "explicit_confusion" && a.participantId === participantId
      ),
      groupStalled: input.progressState === "stalled",
      offersThisScenario: offers.length,
      lastOfferAt: offers.map((offer) => offer.createdAt).sort().at(-1) ?? null,
      pendingOffer: offers.some((offer) => PENDING.includes(offer.status)),
      lastStepTwoAt: stepTwo.map((row) => row.lastToggledAt).sort().at(-1) ?? null,
      usedTypes: [...usedTypes],
      lightHelpReceived: [...usedTypes].some((type) => supportLevel(type) === 1),
    };
  }

  // ---------------------------------------------------------------------------
  // Rewards
  // ---------------------------------------------------------------------------

  /** Applies every reward that has become due for this member's popup offers. */
  reconcile(ref: LearnerRef): void {
    const offers = this.adaptiveOffers(ref.sessionId, ref.participantId);
    if (offers.length === 0) return;
    const done = this.store.offerEventKeys(ref.participantId);
    for (const offer of offers) {
      if (!done.has(`response:${offer.id}`)) this.applyResponse(ref, offer);
      if (offer.status === "delivered" && !done.has(`outcome:${offer.id}`)) this.applyOutcome(ref, offer);
      if (offer.status === "failed" && !done.has(`outcome:${offer.id}`)) {
        this.store.apply({
          ...this.modelRef(ref),
          scenarioOrder: offer.scenarioOrder,
          eventKey: `outcome:${offer.id}`,
          signal: null,
          interventionId: offer.id,
          detail: { eventType: "help_outcome", skipped: "generation_failed" },
        });
      }
    }
  }

  private modelRef(ref: LearnerRef): ModelRef {
    return { sessionId: ref.sessionId, participantId: ref.participantId, policyVersion: ref.policyVersion, policy: ref.policy, now: ref.now };
  }

  private applyResponse(ref: LearnerRef, offer: InterventionRow) {
    let response: OfferResponse;
    if (ACCEPTED.includes(offer.status)) response = "accepted";
    else if (offer.status === "dismissed") response = "dismissed";
    else if (offer.status === "deferred") response = "deferred";
    else if (offer.status === "expired") response = "expired";
    else return;

    let pauseSeconds: number | null = null;
    if (response === "deferred") {
      const decision = this.store.decisionFor(offer.id);
      const pauseAtOffer = Number(decision?.evidence?.pauseSeconds);
      const deferredAt = offer.resolvedAt ?? ref.now;
      if (Number.isFinite(pauseAtOffer)) {
        pauseSeconds = pauseAtOffer + Math.max(0, (Date.parse(deferredAt) - Date.parse(offer.createdAt)) / 1000);
      }
    }
    if (response !== "accepted") this.store.resolveDeclined(offer.id, ref.now);
    this.store.apply({
      ...this.modelRef(ref),
      scenarioOrder: offer.scenarioOrder,
      eventKey: `response:${offer.id}`,
      signal: { kind: "offer_response", response, pauseSeconds },
      interventionId: offer.id,
    });
  }

  /**
   * Help counts as working when the member contributed themselves afterwards and
   * neither asked for more direct help in Step 2 nor wrote that they were still
   * unsure within the outcome window.
   */
  private applyOutcome(ref: LearnerRef, offer: InterventionRow) {
    if (!offer.deliveredAt || !isAdaptiveArm(offer.supportType)) return;
    const arm = offer.supportType;
    const from = offer.deliveredAt;
    const windowEnd = addSeconds(from, ref.policy.outcomeWindowSeconds);
    const inWindow = (at: string | null | undefined) => !!at && at > from && at <= windowEnd;

    const escalated = this.stepTwoRows(ref.participantId, offer.scenarioOrder).some(
      (row) =>
        supportLevel(row.scaffoldingType) > ARM_LEVEL[arm] &&
        (inWindow(row.createdAt) || (row.selected && inWindow(row.lastToggledAt)))
    );
    const ownMessages = db
      .select({ text: schema.discussionMessages.text, at: schema.discussionMessages.createdAt })
      .from(schema.discussionMessages)
      .where(
        and(
          eq(schema.discussionMessages.sessionId, ref.sessionId),
          eq(schema.discussionMessages.participantId, ref.participantId),
          eq(schema.discussionMessages.scenarioOrder, offer.scenarioOrder),
          gt(schema.discussionMessages.createdAt, from)
        )
      )
      .all()
      .filter((m) => m.at <= windowEnd);
    const stillUnsure = ownMessages.some((m) => isConfusion(m.text));
    const contributed =
      this.ownContributionTimes(ref.sessionId, ref.participantId, offer.scenarioOrder).some(inWindow);
    const attempt = db
      .select({ submitted: schema.scenarioAttempts.submitted })
      .from(schema.scenarioAttempts)
      .where(eq(schema.scenarioAttempts.id, offer.attemptId))
      .get();
    const closed = ref.now >= windowEnd || Boolean(attempt?.submitted);

    let success: boolean;
    let reason: string;
    if (escalated) {
      success = false;
      reason = "asked for more direct help in Step 2";
    } else if (stillUnsure) {
      success = false;
      reason = "wrote that they were still unsure";
    } else if (!closed) {
      return;
    } else if (contributed) {
      success = true;
      reason = "contributed on their own afterwards";
    } else {
      success = false;
      reason = "no own contribution afterwards";
    }
    this.store.apply({
      ...this.modelRef(ref),
      scenarioOrder: offer.scenarioOrder,
      eventKey: `outcome:${offer.id}`,
      signal: { kind: "help_outcome", arm, success, reason },
      interventionId: offer.id,
    });
  }

  /**
   * After submission: a scenario where the member contributed without any AI help
   * raises independence; one where they used moderate or direct help lowers it.
   */
  scenarioFinished(ref: LearnerRef, scenarioOrder: number): void {
    this.reconcile(ref);
    const contributed = this.ownContributionTimes(ref.sessionId, ref.participantId, scenarioOrder).length > 0;
    const used = [
      ...this.stepTwoRows(ref.participantId, scenarioOrder).map((row) => row.scaffoldingType),
      ...this.adaptiveOffers(ref.sessionId, ref.participantId)
        .filter((offer) => offer.scenarioOrder === scenarioOrder && offer.status === "delivered")
        .map((offer) => offer.supportType),
    ];
    const maxLevel = Math.max(0, ...used.map(supportLevel));
    const outcome: ScenarioOutcome =
      contributed && used.length === 0 ? "independent" : maxLevel >= 2 ? "direct_help" : "neutral";
    this.store.apply({
      ...this.modelRef(ref),
      scenarioOrder,
      eventKey: `scenario:${scenarioOrder}`,
      signal: { kind: "scenario_outcome", outcome },
      detail: { contributed, usedSupportTypes: used },
    });
  }

  surveyRated(ref: LearnerRef, scenarioOrder: number, supportAmount: unknown): void {
    if (!isSupportAmountRating(supportAmount)) return;
    this.store.apply({
      ...this.modelRef(ref),
      scenarioOrder,
      eventKey: `survey:${scenarioOrder}`,
      signal: { kind: "survey_rating", supportAmount },
    });
  }
}

export const adaptiveLearner = new AdaptiveLearner();
