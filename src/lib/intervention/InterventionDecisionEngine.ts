import { learningAwareOf, unifiedGroupRulesOf, type InterventionPolicy } from "./policies";
import type {
  CollaborationSnapshot,
  CollaborationState,
  ConditionCapabilities,
  EstimatedGroupState,
  GroupSupportType,
  InterventionAssessment,
  InterventionDecision,
  InterventionScope,
  InterventionTrigger,
  PrivateOfferSupportType,
  ResearchCondition,
} from "./types";

/**
 * Turns monitor assessments into one decision: offer support, or (most often)
 * do nothing, with a reason code either way. Pure, so every branch is testable.
 * Proactive support is only ever an offer; members decide whether to accept it.
 */

export interface PrivateRecommendation {
  level: 1 | 2;
  supportType: PrivateOfferSupportType;
  fadingApplied: boolean;
  rationale: string;
}

export interface DecisionContext {
  condition: ResearchCondition;
  capabilities: ConditionCapabilities;
  policy: InterventionPolicy;
  /** Every active roster member has a valid, non-withdrawn consent. */
  allConsented: boolean;
  proactiveGroupCount: number;
  lastProactiveAt: string | null;
  /** Proactive private offers already made this scenario, per member. */
  privateOfferCounts: Record<string, number>;
  /** A proactive group offer is still waiting for a response. */
  openGroupOffer: boolean;
  openPrivateOfferFor: string[];
  /** Group triggers whose offer was dismissed earlier in this scenario. */
  dismissedTriggers: InterventionTrigger[];
  recommendFor?: (participantId: string) => PrivateRecommendation;
  /** policy-v2-3+: the group-state estimate; enables the context gate. */
  groupState?: EstimatedGroupState | null;
  /** policy-v2-3+: when the latest proactive group prompt was delivered. */
  lastGroupDeliveredAt?: string | null;
  /** policy-v2-3+: triggers whose earlier prompt this scenario was followed by the same obstacle. */
  ineffectiveTriggers?: InterventionTrigger[];
  /** policy-unified-1+: when a member last asked the group AI by hand in this scenario. */
  lastManualGroupAt?: string | null;
  /** policy-unified-1+: a group AI reply (manual or accepted offer) is being generated. */
  groupGenerationInProgress?: boolean;
}

export const TRIGGER_SUPPORT: Record<
  Exclude<InterventionTrigger, "none" | "student_requested" | "adaptive_need">,
  GroupSupportType
> = {
  initial_silence: "participation_invitation",
  stalled_discussion: "reflection_checkpoint",
  explicit_confusion: "reasoning_prompt",
  unresolved_disagreement: "disagreement_mediation",
  possible_participation_imbalance: "perspective_invitation",
  coordination_request: "cognitive_division",
};

const PRIORITY: InterventionTrigger[] = [
  "explicit_confusion",
  "coordination_request",
  "unresolved_disagreement",
  "initial_silence",
  "stalled_discussion",
  "possible_participation_imbalance",
];

/** Shown to members behind "Why this suggestion?". Never names or ranks anyone. */
export const GROUP_EXPLANATIONS: Record<string, string> = {
  initial_silence:
    "No new group activity for a while: nothing has been written since your group started this scenario. The AI can suggest a simple way to get started. You can say no.",
  stalled_discussion:
    "No new group activity for a while: there have been no new messages or answer edits for a few minutes. A short collaboration question can help you decide what to do next. You can say no.",
  explicit_confusion:
    "Someone wrote that they are unsure how to continue, and nobody had replied yet. The AI can suggest a question to think about together. It will not give the answer.",
  unresolved_disagreement:
    "The discussion may be repeating the same positions without new reasons or evidence. The AI can suggest a fair way to compare the views. It will not decide who is right.",
  possible_participation_imbalance:
    "So far the discussion has come mostly from part of the group. The AI can suggest a way to hear every viewpoint. Nobody is being singled out, and everyone decides how much to say.",
  coordination_request:
    "Someone asked how the group should organise the work. The AI can suggest a way to divide the thinking. The group decides.",
};

export const PRIVATE_EXPLANATION =
  "You wrote that you were unsure, and you chose to receive private suggestions. Only you can see this offer. It starts with the smallest useful help and will not give the answer.";

const NO_ACTION_EXPLANATIONS: Record<string, string> = {
  scenario_submitted: "The scenario is already submitted.",
  consent_incomplete: "Not every active member has a valid consent; no support is offered.",
  no_difficulty_detected: "No difficulty was detected.",
  productive_progress: "The group is making progress; productive struggle is left alone.",
  group_not_present: "Too few members are connected for a group-level prompt.",
  offer_pending: "An earlier offer is still waiting for a response.",
  max_prompts_reached: "The maximum number of proactive prompts for this scenario was reached.",
  cooldown_active: "A proactive prompt was offered recently (cooldown).",
  previously_dismissed: "The group already declined an offer for this situation in this scenario.",
  insufficient_evidence: "The evidence was too weak to justify interrupting.",
  max_private_offers_reached: "This member already received the maximum private offers for this scenario.",
  context_productive: "The group is producing new ideas, reasons or answer revisions; it is left alone.",
  context_constructive_disagreement:
    "The group disagrees but keeps adding new reasons or revising the answer; productive disagreement is left alone.",
  context_gate_uncertain: "The evidence about the group's situation is weak, stale or contradictory; no interruption.",
  context_state_mismatch: "The rule matched, but the group-state estimate does not show that difficulty.",
  awaiting_outcome: "A group prompt was delivered recently; its effect is observed before offering another.",
  previous_prompt_ineffective:
    "The same kind of prompt was already delivered in this scenario and the difficulty continued; it is not repeated.",
  not_a_proactive_group_reason:
    "Proactive group offers are only made when the group seems stuck or going in circles; this situation is left to the members (and to private help).",
  final_answer_in_progress: "A member is confirming the final answer; the group is not interrupted.",
  group_ai_generating: "A group AI reply is already being prepared.",
  recent_manual_group_request: "A member asked the group AI by hand recently; no extra offer is added.",
};

/** Inferred patterns need the group-state estimate to agree before the group is interrupted. */
const INFERRED_REQUIRED_STATE: Partial<Record<InterventionTrigger, CollaborationState[]>> = {
  initial_silence: ["possible_stall"],
  stalled_discussion: ["possible_stall"],
  unresolved_disagreement: ["unproductive_conflict"],
};
const INFERRED: InterventionTrigger[] = [
  "initial_silence",
  "stalled_discussion",
  "unresolved_disagreement",
  "possible_participation_imbalance",
];

interface Candidate {
  assessment: InterventionAssessment;
  scope: InterventionScope;
  targetParticipantId?: string;
}

type Eligibility = { ok: true } | { ok: false; reasonCode: string };

const EXPLICIT: InterventionTrigger[] = ["explicit_confusion", "coordination_request"];

export class InterventionDecisionEngine {
  decide(
    snapshot: CollaborationSnapshot,
    assessments: InterventionAssessment[],
    ctx: DecisionContext
  ): InterventionDecision {
    const base = { policyVersion: ctx.policy.version, condition: ctx.condition };
    const top = this.rank(assessments)[0];

    if (snapshot.submitted) return this.noAction(base, top, "scenario_submitted");
    if (!ctx.allConsented) return this.noAction(base, top, "consent_incomplete");
    if (!top || top.trigger === "none") {
      const state = ctx.groupState?.state;
      if (state === "productive") return this.noAction(base, top, "context_productive");
      if (state === "constructive_disagreement") return this.noAction(base, top, "context_constructive_disagreement");
      const progress = assessments[0]?.progressState;
      return this.noAction(base, top, progress === "productive" ? "productive_progress" : "no_difficulty_detected");
    }

    let firstRejection: { candidate: Candidate; reasonCode: string } | null = null;
    for (const assessment of this.rank(assessments)) {
      const candidate = this.chooseScope(assessment, snapshot, ctx);
      const eligibility = this.checkEligibility(candidate, snapshot, ctx);
      if (!eligibility.ok) {
        // A situation the unified rules never act on should not hide why an eligible trigger was held back.
        if (!firstRejection || firstRejection.reasonCode === "not_a_proactive_group_reason") {
          firstRejection = { candidate, reasonCode: eligibility.reasonCode };
        }
        continue;
      }
      if (candidate.scope === "group" && !ctx.capabilities.proactiveGroup) {
        return {
          ...base,
          action: "no_action",
          scope: "group",
          trigger: assessment.trigger,
          supportType: this.groupSupportFor(assessment.trigger),
          recommendedLevel: "process",
          reasonCode: "condition_no_proactive",
          reasonExplanation: `Shadow only: this condition never shows proactive support. The system would have offered "${this.groupSupportFor(assessment.trigger)}" because: ${assessment.evidenceSummary}`,
          assessment,
        };
      }
      return this.offer(base, candidate, ctx);
    }

    const rejected = firstRejection!;
    return {
      ...this.noAction(base, rejected.candidate.assessment, rejected.reasonCode),
      scope: rejected.candidate.scope,
      targetParticipantId: rejected.candidate.targetParticipantId,
    };
  }

  /** Explicit, member-authored signals first; inferred patterns last. */
  rank(assessments: InterventionAssessment[]): InterventionAssessment[] {
    const order = (a: InterventionAssessment) => {
      const index = PRIORITY.indexOf(a.trigger);
      const personalBoost = a.participantId ? -0.5 : 0;
      return (index === -1 ? PRIORITY.length : index) + personalBoost;
    };
    return [...assessments].sort((a, b) => order(a) - order(b));
  }

  /**
   * Personal confusion becomes a private offer only for members who opted in, in
   * the dual condition. Everything else is a group-level prompt that names nobody.
   */
  chooseScope(
    assessment: InterventionAssessment,
    snapshot: CollaborationSnapshot,
    ctx: DecisionContext
  ): Candidate {
    if (
      assessment.trigger === "explicit_confusion" &&
      assessment.participantId &&
      ctx.capabilities.proactivePrivate &&
      snapshot.privateOptInParticipantIds.includes(assessment.participantId)
    ) {
      return { assessment, scope: "individual", targetParticipantId: assessment.participantId };
    }
    return { assessment, scope: "group" };
  }

  checkEligibility(candidate: Candidate, snapshot: CollaborationSnapshot, ctx: DecisionContext): Eligibility {
    const { assessment } = candidate;
    const policy = ctx.policy;
    const explicit = EXPLICIT.includes(assessment.trigger);

    if (assessment.confidence < 0.5) return { ok: false, reasonCode: "insufficient_evidence" };

    if (candidate.scope === "individual") {
      const target = candidate.targetParticipantId!;
      if (!snapshot.onlineParticipantIds.includes(target)) return { ok: false, reasonCode: "group_not_present" };
      if (ctx.openPrivateOfferFor.includes(target)) return { ok: false, reasonCode: "offer_pending" };
      if ((ctx.privateOfferCounts[target] ?? 0) >= policy.maxProactivePrivatePerParticipantPerScenario) {
        return { ok: false, reasonCode: "max_private_offers_reached" };
      }
      return { ok: true };
    }

    const unified = unifiedGroupRulesOf(policy);
    if (unified && !unified.proactiveTriggers.includes(assessment.trigger)) {
      return { ok: false, reasonCode: "not_a_proactive_group_reason" };
    }
    const online = snapshot.onlineParticipantIds.filter((id) => snapshot.activeParticipantIds.includes(id));
    if (online.length < policy.minActiveMembersForGroupTriggers) return { ok: false, reasonCode: "group_not_present" };
    if (unified && (snapshot.readyParticipantIds?.length ?? 0) > 0) {
      return { ok: false, reasonCode: "final_answer_in_progress" };
    }
    if (unified && ctx.groupGenerationInProgress) return { ok: false, reasonCode: "group_ai_generating" };
    const learningAware = learningAwareOf(policy);
    if (learningAware && ctx.groupState) {
      // V2.3: the group-state estimate replaces the activity-only "productive" check,
      // so a lively but circular argument is not mistaken for progress.
      const gate = this.contextGate(assessment.trigger, ctx.groupState, learningAware.contextGate.minConfidenceToAct);
      if (!gate.ok) return gate;
      if (
        !explicit &&
        ctx.lastGroupDeliveredAt &&
        Date.parse(snapshot.now) - Date.parse(ctx.lastGroupDeliveredAt) < learningAware.outcome.windowSeconds * 1000
      ) {
        return { ok: false, reasonCode: "awaiting_outcome" };
      }
      if (ctx.ineffectiveTriggers?.includes(assessment.trigger)) {
        return { ok: false, reasonCode: "previous_prompt_ineffective" };
      }
    } else if (!explicit && assessment.progressState === "productive") {
      return { ok: false, reasonCode: "productive_progress" };
    }
    if (ctx.openGroupOffer) return { ok: false, reasonCode: "offer_pending" };
    if (ctx.proactiveGroupCount >= policy.maxProactiveGroupPerScenario) {
      return { ok: false, reasonCode: "max_prompts_reached" };
    }
    if (!this.checkCooldown(ctx.lastProactiveAt, snapshot.now, policy)) return { ok: false, reasonCode: "cooldown_active" };
    if (unified && !this.checkCooldown(ctx.lastManualGroupAt ?? null, snapshot.now, policy)) {
      return { ok: false, reasonCode: "recent_manual_group_request" };
    }
    if (ctx.dismissedTriggers.includes(assessment.trigger)) return { ok: false, reasonCode: "previously_dismissed" };
    return { ok: true };
  }

  /**
   * V2.3 context gate for group prompts: productive work and constructive
   * disagreement are protected, and inferred patterns need the estimate to agree
   * with enough confidence. Explicit member requests are not second-guessed.
   */
  contextGate(trigger: InterventionTrigger, state: EstimatedGroupState, minConfidence: number): Eligibility {
    if (!INFERRED.includes(trigger)) return { ok: true };
    if (state.state === "productive") return { ok: false, reasonCode: "context_productive" };
    if (state.state === "constructive_disagreement") return { ok: false, reasonCode: "context_constructive_disagreement" };
    if (state.state === "uncertain" || state.confidence < minConfidence) {
      return { ok: false, reasonCode: "context_gate_uncertain" };
    }
    const required = INFERRED_REQUIRED_STATE[trigger];
    if (required && !required.includes(state.state)) return { ok: false, reasonCode: "context_state_mismatch" };
    return { ok: true };
  }

  checkCooldown(lastProactiveAt: string | null, now: string, policy: InterventionPolicy): boolean {
    if (!lastProactiveAt) return true;
    return Date.parse(now) - Date.parse(lastProactiveAt) >= policy.cooldownSeconds * 1000;
  }

  groupSupportFor(trigger: InterventionTrigger): GroupSupportType {
    if (trigger === "none" || trigger === "student_requested" || trigger === "adaptive_need") return "reasoning_prompt";
    return TRIGGER_SUPPORT[trigger];
  }

  private offer(
    base: { policyVersion: string; condition: ResearchCondition },
    candidate: Candidate,
    ctx: DecisionContext
  ): InterventionDecision {
    const { assessment } = candidate;
    const isPrivate =
      candidate.scope === "individual" &&
      candidate.targetParticipantId !== undefined &&
      ctx.capabilities.proactivePrivate;
    if (isPrivate) {
      const recommendation = ctx.recommendFor?.(candidate.targetParticipantId!) ?? {
        level: 1 as const,
        supportType: "hint" as const,
        fadingApplied: false,
        rationale: "default minimal level",
      };
      return {
        ...base,
        action: "offer",
        scope: "individual",
        targetParticipantId: candidate.targetParticipantId,
        trigger: assessment.trigger,
        supportType: recommendation.supportType,
        recommendedLevel: recommendation.level,
        reasonCode: "explicit_confusion_private",
        reasonExplanation: PRIVATE_EXPLANATION,
        assessment,
      };
    }
    return {
      ...base,
      action: "offer",
      scope: "group",
      trigger: assessment.trigger,
      supportType: this.groupSupportFor(assessment.trigger),
      recommendedLevel: "process",
      reasonCode: assessment.trigger,
      reasonExplanation: GROUP_EXPLANATIONS[assessment.trigger] ?? GROUP_EXPLANATIONS.stalled_discussion,
      assessment: { ...assessment, participantId: undefined },
    };
  }

  private noAction(
    base: { policyVersion: string; condition: ResearchCondition },
    assessment: InterventionAssessment | undefined,
    reasonCode: string
  ): InterventionDecision {
    return {
      ...base,
      action: "no_action",
      trigger: assessment?.trigger ?? "none",
      reasonCode,
      reasonExplanation: NO_ACTION_EXPLANATIONS[reasonCode] ?? reasonCode,
      assessment,
    };
  }
}

export const decisionEngine = new InterventionDecisionEngine();
