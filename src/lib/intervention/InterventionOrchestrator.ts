import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { groupFacilitator, type GeneratedSupport, type GroupAIFacilitator } from "@/lib/ai/GroupAIFacilitator";
import { personalCoach, type PersonalInterventionCoach } from "@/lib/ai/PersonalInterventionCoach";
import { isRealAiConfigured } from "@/lib/ai/provider";
import { describeAiError } from "@/lib/ai/scaffold";
import {
  ADAPTIVE_REASON_CODE,
  adaptiveLearner,
  type LearnerRef,
} from "@/lib/intervention/adaptive/AdaptiveLearner";
import { decideAdaptiveOffer, type AdaptiveDecision } from "@/lib/intervention/adaptive/AdaptivePrivatePolicy";
import { learnerStore } from "@/lib/intervention/adaptive/LearnerModelStore";
import { adaptiveEngine } from "@/lib/intervention/AdaptiveScaffoldingEngine";
import {
  CollaborationMonitor,
  type DisagreementClassifier,
  type MonitorResult,
} from "@/lib/intervention/CollaborationMonitor";
import {
  decisionEngine,
  type DecisionContext,
} from "@/lib/intervention/InterventionDecisionEngine";
import {
  researchLogger,
  type EvaluationSource,
  type InterventionRow,
} from "@/lib/intervention/InterventionResearchLogger";
import { getPolicy, type InterventionPolicy } from "@/lib/intervention/policies";
import { listActiveRooms } from "@/lib/intervention/presence";
import {
  FACILITATOR_PROMPT_VERSION,
  GROUP_SUPPORT_LABELS,
  PRIVATE_OFFER_PROMPT_VERSION,
} from "@/lib/intervention/prompts";
import {
  capabilitiesFor,
  conditionOf,
  type StudyAssignment,
} from "@/lib/intervention/ResearchConditionManager";
import { EligibilityError, eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import {
  isGroupSupportType,
  MANUAL_GROUP_SUPPORT_TYPES,
  type CollaborationSnapshot,
  type FeedbackAction,
  type GroupSupportType,
  type InterventionDecision,
  type InterventionTrigger,
  type InterventionView,
  type PrivateOfferSupportType,
} from "@/lib/intervention/types";
import { emitToGroup, emitToParticipant } from "@/lib/realtime/emit";
import {
  activityWatermark,
  checkV2PrivateSupportGate,
  expireStaleOffers,
  getActiveRosterIds,
  getMemberDirectory,
  listCheckpointViews,
  listSharedIdeas,
  listVisibleInterventions,
  loadSnapshot,
  toInterventionView,
} from "@/lib/services/interventions";
import { getOrCreateAttempt } from "@/lib/services/sessions";
import { getScenarioByOrder } from "@/lib/utils/scenarios";

/**
 * Central glue for V2 facilitation. Evaluations run server-side, debounced after
 * validated human activity and on a coarse scheduler while members are connected.
 * State is persisted before anything is broadcast; clients reconcile on reload.
 * Facilitation failures are logged and never block chat or the answer editor.
 */

type Session = typeof schema.sessions.$inferSelect;
type Attempt = typeof schema.scenarioAttempts.$inferSelect;
type Participant = typeof schema.participants.$inferSelect;

export interface ActivityEvent {
  sessionId: string;
  sessionCode: string;
  scenarioOrder: number;
  participantId: string;
  kind: "message" | "edit";
}

export interface EvaluationOutcome {
  decision: InterventionDecision;
  evaluationId: string;
  collapsed: boolean;
  intervention: InterventionRow | null;
}

export interface OrchestratorDeps {
  clock?: () => Date;
  facilitator?: GroupAIFacilitator;
  coach?: PersonalInterventionCoach;
  classifier?: DisagreementClassifier | null;
}

const OPEN_GROUP = ["suggested", "accepted"];
const OPEN_PRIVATE = ["suggested", "deferred", "accepted"];

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

export class InterventionOrchestrator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<EvaluationOutcome | null>>();
  private readonly rerun = new Set<string>();
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private readonly clock: () => Date;
  private readonly facilitator: GroupAIFacilitator;
  private readonly coach: PersonalInterventionCoach;
  private readonly classifier: DisagreementClassifier | null;

  constructor(deps: OrchestratorDeps = {}) {
    this.clock = deps.clock ?? (() => new Date());
    this.facilitator = deps.facilitator ?? groupFacilitator;
    this.coach = deps.coach ?? personalCoach;
    this.classifier = deps.classifier ?? null;
  }

  private now(): string {
    return this.clock().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------

  /** Debounced: a burst of messages/edits leads to one evaluation. */
  onHumanActivity(event: ActivityEvent): void {
    const key = `${event.sessionId}:${event.scenarioOrder}`;
    void (async () => {
      const assignment = await eligibilityGuard.getAssignment(event.sessionId);
      if (!assignment?.rosterFrozenAt) return;
      const policy = getPolicy(assignment.interventionPolicyVersion);
      const existing = this.timers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.timers.delete(key);
        this.evaluateAttempt(event.sessionId, event.scenarioOrder, "human_activity").catch((error) =>
          console.error("Intervention evaluation failed:", error)
        );
      }, policy.evaluationDebounceMs);
      timer.unref?.();
      this.timers.set(key, timer);
    })().catch((error) => console.error("Scheduling evaluation failed:", error));
  }

  /** One evaluation per attempt at a time; a request during a run schedules one rerun. */
  evaluateAttempt(
    sessionId: string,
    scenarioOrder: number,
    source: EvaluationSource = "scheduler"
  ): Promise<EvaluationOutcome | null> {
    const key = `${sessionId}:${scenarioOrder}`;
    const inflight = this.running.get(key);
    if (inflight) {
      this.rerun.add(key);
      return inflight;
    }
    const run = this.runEvaluation(sessionId, scenarioOrder, source).finally(() => {
      this.running.delete(key);
      if (this.rerun.delete(key)) {
        this.evaluateAttempt(sessionId, scenarioOrder, source).catch((error) =>
          console.error("Intervention re-evaluation failed:", error)
        );
      }
    });
    this.running.set(key, run);
    return run;
  }

  /** Coarse inactivity checks, only for scenario rooms with connected V2 members. */
  startScheduler(intervalMs: number) {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => {
      for (const room of listActiveRooms()) {
        this.evaluateAttempt(room.sessionId, room.scenarioOrder, "scheduler").catch((error) =>
          console.error("Scheduled evaluation failed:", error)
        );
      }
    }, intervalMs);
    this.scheduler.unref?.();
  }

  stop() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Waits for any running evaluation (tests). */
  async idle() {
    while (this.running.size > 0) await Promise.all([...this.running.values()]);
  }

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  private loadContext(sessionId: string, scenarioOrder: number) {
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    if (!session) return null;
    const assignment = db
      .select()
      .from(schema.studyAssignments)
      .where(eq(schema.studyAssignments.sessionId, sessionId))
      .get();
    if (!assignment?.rosterFrozenAt) return null;
    const attempt = db
      .select()
      .from(schema.scenarioAttempts)
      .where(
        and(eq(schema.scenarioAttempts.sessionId, sessionId), eq(schema.scenarioAttempts.scenarioOrder, scenarioOrder))
      )
      .get();
    return { session, assignment, attempt: attempt ?? null };
  }

  private async runEvaluation(
    sessionId: string,
    scenarioOrder: number,
    source: EvaluationSource
  ): Promise<EvaluationOutcome | null> {
    const context = this.loadContext(sessionId, scenarioOrder);
    if (!context?.attempt || context.attempt.submitted) return null;
    const { session, assignment, attempt } = context;
    const condition = conditionOf(assignment);
    const capabilities = capabilitiesFor(condition);
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const shadowOnly = !capabilities.proactiveGroup && !capabilities.proactivePrivate;
    if (shadowOnly && !policy.shadowMonitoringInPassiveConditions) return null;

    const now = this.now();
    for (const row of expireStaleOffers(attempt.id, now)) this.broadcast(session, row, "intervention:state");

    const snapshot = loadSnapshot({ session, assignment, attempt, now, policy });
    const monitor = new CollaborationMonitor(policy);
    const result = await monitor.evaluate(snapshot, {
      classifier: this.classifier,
      allowClassifier: !shadowOnly && isRealAiConfigured(),
    });
    const ctx = this.decisionContext(snapshot, policy, assignment);
    // With adaptive private suggestions, one member's own "I'm unsure" is answered privately, not with a group prompt.
    const groupAssessments = capabilities.adaptivePrivate
      ? result.assessments.filter((a) => !(a.trigger === "explicit_confusion" && a.participantId))
      : result.assessments;
    const decision = decisionEngine.decide(snapshot, groupAssessments, ctx);
    const watermark = activityWatermark(snapshot);
    const logged = researchLogger.logDecision({
      sessionId,
      attemptId: attempt.id,
      scenarioOrder,
      source,
      decision,
      assessments: result.assessments,
      watermark,
      onlineCount: snapshot.onlineParticipantIds.length,
      activeMemberCount: snapshot.activeParticipantIds.length,
      classifierModel: result.classifierModel,
      classifierNote: result.classifierNote,
      shadowOnly,
      now,
    });

    let intervention: InterventionRow | null = null;
    if (decision.action === "offer") {
      intervention = this.createProactiveOffer({
        session,
        assignment,
        attempt,
        policy,
        decision,
        evaluationId: logged.evaluationId,
        watermark,
        now,
      });
    }
    if (capabilities.adaptivePrivate) {
      await this.evaluateAdaptivePrivate({ session, assignment, attempt, policy, snapshot, monitor: result });
    }
    return { decision, evaluationId: logged.evaluationId, collapsed: logged.collapsed, intervention };
  }

  private learnerRef(assignment: StudyAssignment, participantId: string, now: string): LearnerRef | null {
    const policy = getPolicy(assignment.interventionPolicyVersion);
    if (!capabilitiesFor(conditionOf(assignment)).adaptivePrivate || !policy.adaptivePrivate) return null;
    return {
      sessionId: assignment.sessionId,
      participantId,
      policyVersion: policy.version,
      policy: policy.adaptivePrivate,
      now,
    };
  }

  /**
   * Applies due rewards for every active member, then lets each connected member's
   * own learner model decide whether to offer them private help now.
   */
  private async evaluateAdaptivePrivate(input: {
    session: Session;
    assignment: StudyAssignment;
    attempt: Attempt;
    policy: InterventionPolicy;
    snapshot: CollaborationSnapshot;
    monitor: MonitorResult;
  }) {
    const { session, assignment, attempt, snapshot } = input;
    const adaptive = input.policy.adaptivePrivate;
    if (!adaptive) return;
    for (const participantId of snapshot.activeParticipantIds) {
      const ref = this.learnerRef(assignment, participantId, snapshot.now)!;
      try {
        adaptiveLearner.reconcile(ref);
        if (!snapshot.onlineParticipantIds.includes(participantId)) continue;
        if (await checkV2PrivateSupportGate(assignment, participantId, attempt.scenarioOrder)) continue;
        const state = adaptiveLearner.syncPace(ref, attempt.scenarioOrder);
        const context = adaptiveLearner.context({
          snapshot,
          participantId,
          assessments: input.monitor.assessments,
          progressState: input.monitor.progress.state,
        });
        const decision = decideAdaptiveOffer(state, context, adaptive);
        if (decision.action === "offer") {
          this.createAdaptiveOffer({ session, assignment, attempt, policy: input.policy, participantId, decision, now: snapshot.now });
        }
      } catch (error) {
        console.error("Adaptive private evaluation failed:", error);
      }
    }
  }

  private createAdaptiveOffer(input: {
    session: Session;
    assignment: StudyAssignment;
    attempt: Attempt;
    policy: InterventionPolicy;
    participantId: string;
    decision: Extract<AdaptiveDecision, { action: "offer" }>;
    now: string;
  }) {
    const { session, assignment, attempt, policy, participantId, decision, now } = input;
    const { row, created } = researchLogger.logOffer(
      {
        sessionId: session.id,
        attemptId: attempt.id,
        scenarioOrder: attempt.scenarioOrder,
        scope: "individual",
        recipientParticipantId: participantId,
        initiatedBy: "system",
        trigger: "adaptive_need",
        category: "content",
        supportType: decision.arm,
        scaffoldLevel: String(decision.level),
        status: "suggested",
        offerText: this.coach.makePrivateOffer(decision.arm),
        reasonCode: ADAPTIVE_REASON_CODE,
        reasonExplanation: decision.explanation,
        researchCondition: conditionOf(assignment),
        policyVersion: policy.version,
        promptVersion: PRIVATE_OFFER_PROMPT_VERSION,
        // One offer per decision draw: the seed already identifies member, scenario, pause and model state.
        idempotencyKey: `adaptive:${attempt.id}:${decision.evidence.seed}`,
        createdAt: now,
        expiresAt: addSeconds(now, policy.adaptivePrivate!.offerExpirySeconds),
      },
      { proactive: true, now }
    );
    if (!created) return;
    learnerStore.logDecision({
      sessionId: session.id,
      participantId,
      scenarioOrder: attempt.scenarioOrder,
      interventionId: row.id,
      decision,
      now,
    });
    this.broadcast(session, row, "intervention:offered");
  }

  /** A Step 2 choice can settle an open popup outcome early (asking for more direct help). */
  onStepTwoSelection(input: { assignment: StudyAssignment; participantId: string }) {
    const ref = this.learnerRef(input.assignment, input.participantId, this.now());
    if (!ref) return;
    try {
      adaptiveLearner.reconcile(ref);
    } catch (error) {
      console.error("Adaptive learner update after Step 2 failed:", error);
    }
  }

  /** The end-of-scenario "support amount" rating updates how often this member is offered help. */
  onSurveyRated(input: { assignment: StudyAssignment; participantId: string; scenarioOrder: number; supportAmount: unknown }) {
    const ref = this.learnerRef(input.assignment, input.participantId, this.now());
    if (!ref) return;
    try {
      adaptiveLearner.surveyRated(ref, input.scenarioOrder, input.supportAmount);
    } catch (error) {
      console.error("Adaptive learner update after the survey failed:", error);
    }
  }

  private decisionContext(
    snapshot: CollaborationSnapshot,
    policy: InterventionPolicy,
    assignment: StudyAssignment
  ): DecisionContext {
    const condition = conditionOf(assignment);
    const capabilities = capabilitiesFor(condition);
    const items = snapshot.previousInterventions;
    const proactiveGroup = items.filter((i) => i.scope === "group" && i.initiatedBy === "system");
    const privateItems = items.filter((i) => i.scope === "individual");
    const privateOfferCounts: Record<string, number> = {};
    for (const item of privateItems) {
      if (item.initiatedBy === "system" && item.recipientParticipantId) {
        privateOfferCounts[item.recipientParticipantId] = (privateOfferCounts[item.recipientParticipantId] ?? 0) + 1;
      }
    }
    return {
      condition,
      capabilities,
      policy,
      allConsented: snapshot.activeParticipantIds.length > 0,
      proactiveGroupCount: proactiveGroup.length,
      lastProactiveAt: proactiveGroup.map((i) => i.createdAt).sort().at(-1) ?? null,
      privateOfferCounts,
      openGroupOffer: proactiveGroup.some((i) => OPEN_GROUP.includes(i.status)),
      openPrivateOfferFor: privateItems
        .filter((i) => OPEN_PRIVATE.includes(i.status) && i.recipientParticipantId)
        .map((i) => i.recipientParticipantId!),
      dismissedTriggers: proactiveGroup.filter((i) => i.status === "dismissed").map((i) => i.trigger),
      recommendFor: capabilities.fading
        ? (participantId) => {
            const history = adaptiveEngine.buildHistory(
              snapshot.sessionId,
              participantId,
              snapshot.scenarioOrder,
              policy.fadingLookbackScenarios
            );
            return adaptiveEngine.recommendLevel(history, policy.fadingLookbackScenarios);
          }
        : undefined,
    };
  }

  private createProactiveOffer(input: {
    session: Session;
    assignment: StudyAssignment;
    attempt: Attempt;
    policy: InterventionPolicy;
    decision: InterventionDecision;
    evaluationId: string;
    watermark: string;
    now: string;
  }): InterventionRow | null {
    const { session, attempt, policy, decision, now } = input;
    const isGroup = decision.scope === "group";
    const supportType = decision.supportType ?? "reasoning_prompt";
    const cooldownBucket = Math.floor(Date.parse(now) / (Math.max(policy.cooldownSeconds, 1) * 1000));
    const idempotencyKey = [
      "auto",
      attempt.id,
      decision.scope,
      decision.targetParticipantId ?? "group",
      decision.trigger,
      input.watermark,
      policy.version,
      cooldownBucket,
    ].join(":");
    const { row, created } = researchLogger.logOffer(
      {
        sessionId: session.id,
        attemptId: attempt.id,
        scenarioOrder: attempt.scenarioOrder,
        evaluationId: input.evaluationId,
        scope: isGroup ? "group" : "individual",
        recipientParticipantId: isGroup ? null : decision.targetParticipantId,
        initiatedBy: "system",
        trigger: decision.trigger,
        category: isGroup ? "process" : "content",
        supportType,
        scaffoldLevel: String(decision.recommendedLevel ?? (isGroup ? "process" : 1)),
        status: "suggested",
        offerText: isGroup
          ? `The AI facilitator has a suggestion for your group: ${GROUP_SUPPORT_LABELS[supportType as GroupSupportType] ?? "a process prompt"}. Would you like to see it?`
          : this.coach.makePrivateOffer(supportType as PrivateOfferSupportType),
        reasonCode: decision.reasonCode,
        reasonExplanation: decision.reasonExplanation,
        researchCondition: decision.condition,
        policyVersion: decision.policyVersion,
        promptVersion: isGroup ? FACILITATOR_PROMPT_VERSION : PRIVATE_OFFER_PROMPT_VERSION,
        idempotencyKey,
        createdAt: now,
        expiresAt: addSeconds(now, policy.offerExpirySeconds),
      },
      { proactive: true, now }
    );
    if (!created) return row;
    if (!isGroup && decision.targetParticipantId) {
      adaptiveEngine.ensureRecommendation({
        sessionId: session.id,
        participantId: decision.targetParticipantId,
        scenarioOrder: attempt.scenarioOrder,
        lookback: policy.fadingLookbackScenarios,
        interventionId: row.id,
      });
    }
    this.broadcast(session, row, "intervention:offered");
    return row;
  }

  // ---------------------------------------------------------------------------
  // Member actions
  // ---------------------------------------------------------------------------

  /** A member asks the shared facilitator for process help; everyone sees the result. */
  async handleManualGroupRequest(input: {
    session: Session;
    assignment: StudyAssignment;
    participant: Participant;
    scenarioOrder: number;
    supportType: unknown;
    requestId?: unknown;
  }): Promise<{ view: InterventionView; duplicate: boolean }> {
    const { session, assignment, participant, scenarioOrder } = input;
    const capabilities = capabilitiesFor(conditionOf(assignment));
    if (!capabilities.sharedManual) {
      throw new EligibilityError("The shared AI facilitator is not part of this study condition", "not_in_condition", 403);
    }
    if (!isGroupSupportType(input.supportType) || !MANUAL_GROUP_SUPPORT_TYPES.includes(input.supportType)) {
      throw new EligibilityError("Unknown kind of group help", "invalid_support_type", 400);
    }
    const supportType = input.supportType;
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
    if (attempt.submitted) {
      throw new EligibilityError("This scenario is finished, so no new AI support can be requested", "scenario_submitted", 409);
    }
    const gate = await checkV2PrivateSupportGate(assignment, participant.id, scenarioOrder);
    if (gate) throw new EligibilityError(gate.error, gate.code, gate.status);

    const requestId = typeof input.requestId === "string" ? input.requestId.slice(0, 64) : crypto.randomUUID();
    const idempotencyKey = `manual:${attempt.id}:${participant.id}:${requestId}`;
    const existingByKey = db
      .select()
      .from(schema.interventions)
      .where(eq(schema.interventions.idempotencyKey, idempotencyKey))
      .get();
    if (existingByKey) return { view: this.viewFor(session, existingByKey, participant.id, policy), duplicate: true };

    const manual = db
      .select()
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.attemptId, attempt.id),
          eq(schema.interventions.scope, "group"),
          eq(schema.interventions.initiatedBy, "participant")
        )
      )
      .all();
    const generating = manual.find((m) => m.status === "accepted" && m.supportType === supportType);
    if (generating) return { view: this.viewFor(session, generating, participant.id, policy), duplicate: true };
    if (manual.length >= policy.maxManualGroupRequestsPerScenario) {
      throw new EligibilityError("Your group has used all facilitator requests for this scenario", "request_limit", 429);
    }
    const now = this.now();
    const mineLatest = manual
      .filter((m) => m.requestedByParticipantId === participant.id)
      .map((m) => m.createdAt)
      .sort()
      .at(-1);
    if (mineLatest && Date.parse(now) - Date.parse(mineLatest) < policy.manualRequestCooldownSeconds * 1000) {
      throw new EligibilityError("Please wait a moment before asking again", "too_fast", 429);
    }

    const snapshot = loadSnapshot({ session, assignment, attempt, now, policy });
    const decision: InterventionDecision = {
      action: "deliver",
      scope: "group",
      trigger: "student_requested",
      supportType,
      recommendedLevel: "process",
      reasonCode: "student_requested",
      reasonExplanation: "A group member asked the shared AI facilitator for this.",
      policyVersion: policy.version,
      condition: conditionOf(assignment),
      assessment: {
        trigger: "student_requested",
        evidenceMessageIds: [],
        evidenceSummary: `Manual request: ${supportType}`,
        confidence: 1,
        progressState: new CollaborationMonitor(policy).isMeaningfulProgress(snapshot).state,
        source: "student_request",
      },
    };
    const logged = researchLogger.logDecision({
      sessionId: session.id,
      attemptId: attempt.id,
      scenarioOrder,
      source: "manual_request",
      decision,
      assessments: decision.assessment ? [decision.assessment] : [],
      watermark: activityWatermark(snapshot),
      onlineCount: snapshot.onlineParticipantIds.length,
      activeMemberCount: snapshot.activeParticipantIds.length,
      shadowOnly: false,
      now,
    });
    const { row, created } = researchLogger.logOffer(
      {
        sessionId: session.id,
        attemptId: attempt.id,
        scenarioOrder,
        evaluationId: logged.evaluationId,
        scope: "group",
        initiatedBy: "participant",
        requestedByParticipantId: participant.id,
        trigger: "student_requested",
        category: "process",
        supportType,
        scaffoldLevel: "process",
        status: "accepted",
        offerText: GROUP_SUPPORT_LABELS[supportType],
        reasonCode: decision.reasonCode,
        reasonExplanation: decision.reasonExplanation,
        researchCondition: decision.condition,
        policyVersion: policy.version,
        promptVersion: FACILITATOR_PROMPT_VERSION,
        acceptedByParticipantId: participant.id,
        idempotencyKey,
        createdAt: now,
        acceptedAt: now,
      },
      { proactive: false, now }
    );
    if (!created) return { view: this.viewFor(session, row, participant.id, policy), duplicate: true };
    this.broadcast(session, row, "intervention:state");
    const final = await this.generateFor(session, assignment, row);
    return { view: this.viewFor(session, final, participant.id, policy), duplicate: false };
  }

  /** "I'm stuck" (dual_adaptive): a private offer at the recommended level; nothing is generated until accepted. */
  async handlePersonalRequest(input: {
    session: Session;
    assignment: StudyAssignment;
    participant: Participant;
    scenarioOrder: number;
    requestId?: unknown;
  }): Promise<{ view: InterventionView; duplicate: boolean }> {
    const { session, assignment, participant, scenarioOrder } = input;
    const capabilities = capabilitiesFor(conditionOf(assignment));
    if (!capabilities.proactivePrivate) {
      throw new EligibilityError("Personal suggestions are not part of this study condition", "not_in_condition", 403);
    }
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
    if (attempt.submitted) {
      throw new EligibilityError("This scenario is finished, so no new AI support can be requested", "scenario_submitted", 409);
    }
    const gate = await checkV2PrivateSupportGate(assignment, participant.id, scenarioOrder);
    if (gate) throw new EligibilityError(gate.error, gate.code, gate.status);

    const mine = db
      .select()
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.attemptId, attempt.id),
          eq(schema.interventions.recipientParticipantId, participant.id)
        )
      )
      .all();
    const open = mine.find((m) => OPEN_PRIVATE.includes(m.status));
    if (open) return { view: this.viewFor(session, open, participant.id, policy), duplicate: true };
    const requests = mine.filter((m) => m.initiatedBy === "participant").length;
    if (requests >= policy.maxPersonalRequestsPerScenario) {
      throw new EligibilityError("You have used all personal requests for this scenario", "request_limit", 429);
    }

    const now = this.now();
    const snapshot = loadSnapshot({ session, assignment, attempt, now, policy });
    const assessment = this.coach.evaluateExplicitNeed(participant.id, snapshot, policy, "button")!;
    const history = adaptiveEngine.buildHistory(session.id, participant.id, scenarioOrder, policy.fadingLookbackScenarios);
    history.current.explicitlyRequestedMore ||= history.current.minimalSupportReceived;
    const recommendation = adaptiveEngine.recommendLevel(history, policy.fadingLookbackScenarios);
    const decision: InterventionDecision = {
      action: "offer",
      scope: "individual",
      targetParticipantId: participant.id,
      trigger: "explicit_confusion",
      supportType: recommendation.supportType,
      recommendedLevel: recommendation.level,
      reasonCode: "student_requested_private",
      reasonExplanation:
        "You pressed \"I'm stuck\". Only you can see this offer. It starts with the smallest useful help and will not give the answer.",
      policyVersion: policy.version,
      condition: conditionOf(assignment),
      assessment,
    };
    const logged = researchLogger.logDecision({
      sessionId: session.id,
      attemptId: attempt.id,
      scenarioOrder,
      source: "personal_request",
      decision,
      assessments: [assessment],
      watermark: activityWatermark(snapshot),
      onlineCount: snapshot.onlineParticipantIds.length,
      activeMemberCount: snapshot.activeParticipantIds.length,
      shadowOnly: false,
      now,
    });
    const requestId = typeof input.requestId === "string" ? input.requestId.slice(0, 64) : crypto.randomUUID();
    const { row, created } = researchLogger.logOffer(
      {
        sessionId: session.id,
        attemptId: attempt.id,
        scenarioOrder,
        evaluationId: logged.evaluationId,
        scope: "individual",
        recipientParticipantId: participant.id,
        initiatedBy: "participant",
        requestedByParticipantId: participant.id,
        trigger: "explicit_confusion",
        category: "content",
        supportType: recommendation.supportType,
        scaffoldLevel: String(recommendation.level),
        status: "suggested",
        offerText: this.coach.makePrivateOffer(recommendation.supportType),
        reasonCode: decision.reasonCode,
        reasonExplanation: decision.reasonExplanation,
        researchCondition: decision.condition,
        policyVersion: policy.version,
        promptVersion: PRIVATE_OFFER_PROMPT_VERSION,
        idempotencyKey: `personal:${attempt.id}:${participant.id}:${requestId}`,
        createdAt: now,
        expiresAt: addSeconds(now, policy.offerExpirySeconds),
      },
      { proactive: false, now }
    );
    if (created) {
      adaptiveEngine.ensureRecommendation({
        sessionId: session.id,
        participantId: participant.id,
        scenarioOrder,
        lookback: policy.fadingLookbackScenarios,
        interventionId: row.id,
      });
      this.broadcast(session, row, "intervention:offered");
    }
    return { view: this.viewFor(session, row, participant.id, policy), duplicate: !created };
  }

  /**
   * Group offers: the first member to accept makes the content public for all;
   * the first to dismiss closes it for all; "Not now" only hides it for that member.
   * Private offers: only the recipient can respond.
   */
  async handlePrivateOfferResponse(input: {
    session: Session;
    assignment: StudyAssignment;
    participant: Participant;
    interventionId: string;
    action: FeedbackAction;
    comment?: string | null;
  }): Promise<InterventionView> {
    const { session, assignment, participant, action } = input;
    const row = db
      .select()
      .from(schema.interventions)
      .where(and(eq(schema.interventions.id, input.interventionId), eq(schema.interventions.sessionId, session.id)))
      .get();
    // Another member's private item is reported as missing, not forbidden.
    if (!row || (row.scope === "individual" && row.recipientParticipantId !== participant.id)) {
      throw new EligibilityError("Suggestion not found", "not_found", 404);
    }
    if (action === "shared") {
      throw new EligibilityError("Use the share preview to share an idea", "use_share", 400);
    }
    if (row.scope === "group" && !getActiveRosterIds(assignment).includes(participant.id)) {
      throw new EligibilityError("You are not an active member of this group", "not_in_roster", 403);
    }
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const now = this.now();
    const attempt = db.select().from(schema.scenarioAttempts).where(eq(schema.scenarioAttempts.id, row.attemptId)).get();
    const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 500) || null : null;

    if (action === "accepted" && attempt?.submitted) {
      throw new EligibilityError("This scenario is finished, so no new AI support can be generated", "scenario_submitted", 409);
    }
    researchLogger.logFeedback({
      sessionId: session.id,
      interventionId: row.id,
      participantId: participant.id,
      action,
      comment,
      now,
    });

    let current = row;
    if (action === "accepted") {
      const won = researchLogger.transition(row.id, ["suggested", "deferred"], {
        status: "accepted",
        acceptedAt: now,
        acceptedByParticipantId: participant.id,
      });
      if (won) {
        this.broadcast(session, won, "intervention:state");
        current = await this.generateFor(session, assignment, won);
      }
    } else if (action === "dismissed") {
      const closed = researchLogger.transition(row.id, ["suggested", "deferred"], { status: "dismissed", resolvedAt: now });
      if (closed) {
        current = closed;
        this.broadcast(session, closed, "intervention:state");
      }
    } else if (action === "deferred" && row.scope === "individual") {
      // A popup answered with "Not now" is closed; the learner model decides later whether to offer again.
      const adaptive = row.reasonCode === ADAPTIVE_REASON_CODE;
      const deferred = researchLogger.transition(
        row.id,
        ["suggested"],
        adaptive ? { status: "deferred", resolvedAt: now, expiresAt: null } : { status: "deferred" }
      );
      if (deferred) current = deferred;
    }

    if (row.reasonCode === ADAPTIVE_REASON_CODE && ["accepted", "dismissed", "deferred"].includes(action)) {
      const ref = this.learnerRef(assignment, participant.id, this.now());
      if (ref) {
        try {
          adaptiveLearner.reconcile(ref);
        } catch (error) {
          console.error("Adaptive learner update after a response failed:", error);
        }
      }
    }

    this.emitFeedback(session, row, participant.id, action);
    const fresh = db.select().from(schema.interventions).where(eq(schema.interventions.id, row.id)).get() ?? current;
    return this.viewFor(session, fresh, participant.id, policy);
  }

  /** Everything a member may see for a scenario: group items + own private items. */
  async hydrateInterventionState(input: { session: Session; assignment: StudyAssignment; scenarioOrder: number; participantId: string }) {
    const policy = getPolicy(input.assignment.interventionPolicyVersion);
    const attempt = db
      .select()
      .from(schema.scenarioAttempts)
      .where(
        and(
          eq(schema.scenarioAttempts.sessionId, input.session.id),
          eq(schema.scenarioAttempts.scenarioOrder, input.scenarioOrder)
        )
      )
      .get();
    const capabilities = capabilitiesFor(conditionOf(input.assignment));
    if (attempt) expireStaleOffers(attempt.id, this.now());
    return {
      interventions: attempt
        ? listVisibleInterventions(attempt.id, input.participantId, input.session.id, policy.deferSeconds)
        : [],
      sharedIdeas: capabilities.sharing ? listSharedIdeas(input.session.id, input.scenarioOrder) : [],
      checkpoints: input.assignment.features.checkpoints
        ? await listCheckpointViews(input.session.id, input.scenarioOrder)
        : [],
    };
  }

  /** Open offers end when the scenario is submitted; nothing new is generated after that. */
  async onScenarioSubmitted(input: { sessionId: string; sessionCode: string; scenarioOrder: number }) {
    const key = `${input.sessionId}:${input.scenarioOrder}`;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).get();
    if (!session) return;
    const now = this.now();
    const open = db
      .select()
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.sessionId, input.sessionId),
          eq(schema.interventions.scenarioOrder, input.scenarioOrder),
          inArray(schema.interventions.status, ["suggested", "deferred"]),
          isNull(schema.interventions.resolvedAt)
        )
      )
      .all();
    for (const row of open) {
      const expired = researchLogger.transition(row.id, ["suggested", "deferred"], { status: "expired", resolvedAt: now });
      if (expired) this.broadcast(session, expired, "intervention:state");
    }

    const assignment = db
      .select()
      .from(schema.studyAssignments)
      .where(eq(schema.studyAssignments.sessionId, input.sessionId))
      .get();
    if (!assignment) return;
    for (const participantId of getActiveRosterIds(assignment)) {
      const ref = this.learnerRef(assignment, participantId, now);
      if (!ref) return;
      try {
        adaptiveLearner.scenarioFinished(ref, input.scenarioOrder);
      } catch (error) {
        console.error("Adaptive learner update after submission failed:", error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Generation and delivery
  // ---------------------------------------------------------------------------

  private async generateFor(session: Session, assignment: StudyAssignment, row: InterventionRow): Promise<InterventionRow> {
    const policy = getPolicy(assignment.interventionPolicyVersion);
    const scenario = getScenarioByOrder(row.scenarioOrder);
    const attempt = db.select().from(schema.scenarioAttempts).where(eq(schema.scenarioAttempts.id, row.attemptId)).get();
    if (!scenario || !attempt) {
      return researchLogger.logFailure(row.id, "scenario not found", this.now()) ?? row;
    }
    const snapshot = loadSnapshot({ session, assignment, attempt, now: this.now(), policy });
    let generated: GeneratedSupport;
    try {
      if (row.scope === "group") {
        const names = getMemberDirectory(session.id);
        const previous = db
          .select({ content: schema.interventions.content })
          .from(schema.interventions)
          .where(
            and(
              eq(schema.interventions.attemptId, attempt.id),
              eq(schema.interventions.scope, "group"),
              eq(schema.interventions.status, "delivered")
            )
          )
          .all()
          .flatMap((p) => (p.content ? [p.content] : []));
        generated = await this.facilitator.generateProcessSupport({
          policy,
          scenario,
          supportType: row.supportType as GroupSupportType,
          snapshot,
          situation: this.facilitator.createSharedPrompt(snapshot, {
            trigger: row.trigger as InterventionTrigger,
          }),
          previousFacilitatorTexts: previous,
          memberNames: [...names.values()].map((m) => m.name),
        });
      } else {
        generated = await this.coach.generatePrivateSupport({
          policy,
          scenario,
          supportType: row.supportType as PrivateOfferSupportType,
          snapshot,
        });
      }
    } catch (error) {
      const failed = researchLogger.logFailure(row.id, describeAiError(error), this.now());
      if (failed) this.broadcast(session, failed, "intervention:state");
      return failed ?? row;
    }

    const latest = db.select().from(schema.scenarioAttempts).where(eq(schema.scenarioAttempts.id, row.attemptId)).get();
    if (latest?.submitted) {
      const failed = researchLogger.logFailure(row.id, "scenario submitted before delivery", this.now(), generated.aiModel);
      if (failed) this.broadcast(session, failed, "intervention:state");
      return failed ?? row;
    }
    const delivered = researchLogger.logDelivery(row.id, generated, this.now());
    if (!delivered) return row;
    this.broadcast(session, delivered, "intervention:delivered");
    if (delivered.scope === "individual" && delivered.recipientParticipantId) {
      await adaptiveEngine.recordOutcome({
        sessionId: session.id,
        participantId: delivered.recipientParticipantId,
        scenarioOrder: delivered.scenarioOrder,
        chosenSupportType: delivered.supportType,
        interventionId: delivered.id,
      });
    }
    return delivered;
  }

  // ---------------------------------------------------------------------------
  // Broadcasting (after persistence). Private items only go to the recipient.
  // ---------------------------------------------------------------------------

  private viewFor(session: Session, row: InterventionRow, participantId: string, policy: InterventionPolicy) {
    const feedback = db
      .select()
      .from(schema.interventionFeedback)
      .where(
        and(
          eq(schema.interventionFeedback.interventionId, row.id),
          eq(schema.interventionFeedback.participantId, participantId)
        )
      )
      .all();
    return toInterventionView(row, getMemberDirectory(session.id), feedback, policy.deferSeconds);
  }

  /** Payloads carry no per-member feedback; each client keeps its own. */
  private broadcast(session: Session, row: InterventionRow, event: string) {
    const view = toInterventionView(row, getMemberDirectory(session.id), [], 0);
    if (row.scope === "group") {
      emitToGroup(session.code, row.scenarioOrder, event, view);
    } else if (row.recipientParticipantId) {
      emitToParticipant(row.recipientParticipantId, event, view);
    }
  }

  private emitFeedback(session: Session, row: InterventionRow, participantId: string, action: FeedbackAction) {
    if (row.scope === "group") {
      const counts = db
        .select({ action: schema.interventionFeedback.action })
        .from(schema.interventionFeedback)
        .where(eq(schema.interventionFeedback.interventionId, row.id))
        .all()
        .reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.action]: (acc[f.action] ?? 0) + 1 }), {});
      emitToGroup(session.code, row.scenarioOrder, "intervention:feedback", { interventionId: row.id, counts });
    } else {
      emitToParticipant(participantId, "intervention:feedback", { interventionId: row.id, action });
    }
  }
}

const globalForOrchestrator = globalThis as typeof globalThis & {
  __collabOrchestrator?: InterventionOrchestrator;
};

/** One orchestrator per process, shared by server.ts and Next route handlers. */
export function getOrchestrator(): InterventionOrchestrator {
  if (!globalForOrchestrator.__collabOrchestrator) {
    globalForOrchestrator.__collabOrchestrator = new InterventionOrchestrator();
  }
  return globalForOrchestrator.__collabOrchestrator;
}

/** Tests: swap in an orchestrator with a fake clock or AI client. */
export function setOrchestrator(orchestrator: InterventionOrchestrator) {
  globalForOrchestrator.__collabOrchestrator?.stop();
  globalForOrchestrator.__collabOrchestrator = orchestrator;
}
