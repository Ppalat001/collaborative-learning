import {
  createRng,
  decisionSeed,
  sampleBeta,
  type AdaptiveContext,
  type AdaptiveEvidence,
} from "../adaptive/AdaptivePrivatePolicy";
import { ADAPTIVE_ARMS, ARM_LEVEL, pausePercentile, summarizeState, type AdaptiveArm, type LearnerState } from "../adaptive/LearnerModel";
import type { AdaptivePrivatePolicy, LearningAwarePolicy } from "../policies";
import type { CollaborationState, ProposedIntervention, ScaffoldingMove, ScaffoldingTier } from "../types";

/**
 * policy-v2-3 decision for one member's private popup. Pure and seeded like the
 * V2 rule (same caps, same one-draw-per-pause-episode seed), with these changes:
 * - a need must be corroborated: the member's own unanswered "I'm unsure", or a
 *   group-level difficulty estimated with enough confidence. A pause alone, or
 *   a quiet member, never triggers an offer;
 * - a member who wrote that they are thinking / working on it is left alone;
 * - "Don't suggest again in this scenario" is a hard stop for this scenario;
 * - the scaffolding tier limits how direct the offered help may be.
 * Explicit Step 2 help is never blocked by any of this.
 */

export const GROUP_DIFFICULTY_STATES: CollaborationState[] = [
  "possible_confusion",
  "possible_stall",
  "coordination_need",
  "unproductive_conflict",
];

export interface LearningAwareContext extends AdaptiveContext {
  tier: ScaffoldingTier;
  /** The member chose "Don't suggest again in this scenario". */
  stopped: boolean;
  /** The member's latest own message says they are thinking / working on it / got it. */
  selfReportedProgress: boolean;
  groupState: CollaborationState | null;
  groupConfidence: number | null;
}

export interface LearningAwareEvidence extends AdaptiveEvidence {
  tier: ScaffoldingTier;
  groupState: CollaborationState | null;
  groupDifficulty: boolean;
  corroborated: boolean;
}

export type LearningAwareDecision =
  | { action: "wait"; reasonCode: string; tier: ScaffoldingTier; move: ScaffoldingMove; evidence: LearningAwareEvidence | null }
  | {
      action: "offer";
      reasonCode: "adaptive_private";
      arm: AdaptiveArm;
      level: 1 | 2;
      tier: ScaffoldingTier;
      move: ScaffoldingMove;
      evidence: LearningAwareEvidence;
      rationale: string;
      explanation: string;
      proposal: ProposedIntervention;
    };

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;
const round = (value: number) => Math.round(value * 1000) / 1000;

export function groupDifficultyOf(ctx: Pick<LearningAwareContext, "groupState" | "groupConfidence">, la: LearningAwarePolicy) {
  return (
    !!ctx.groupState &&
    GROUP_DIFFICULTY_STATES.includes(ctx.groupState) &&
    (ctx.groupConfidence ?? 0) >= la.contextGate.minConfidenceToAct
  );
}

export function decideLearningAwareOffer(
  state: LearnerState,
  ctx: LearningAwareContext,
  policy: AdaptivePrivatePolicy,
  la: LearningAwarePolicy,
  policyVersion: string
): LearningAwareDecision {
  const tier = ctx.tier;
  const wait = (reasonCode: string, evidence: LearningAwareEvidence | null = null): LearningAwareDecision => ({
    action: "wait",
    reasonCode,
    tier,
    move: "remain_silent",
    evidence,
  });
  const { now } = ctx;

  // The V2 safety limits, unchanged.
  if (ctx.submitted) return wait("scenario_submitted");
  if (!ctx.online) return wait("not_online");
  if (ctx.pendingOffer) return wait("offer_pending");
  if (ctx.offersThisScenario >= policy.maxOffersPerScenario) return wait("max_offers_reached");
  if (ctx.lastOfferAt && seconds(ctx.lastOfferAt, now) < policy.minSecondsBetweenOffers) return wait("offer_cooldown");
  if (!ctx.scenarioStartedAt || seconds(ctx.scenarioStartedAt, now) < policy.minSecondsIntoScenario) {
    return wait("scenario_just_started");
  }
  if (ctx.lastStepTwoAt && seconds(ctx.lastStepTwoAt, now) < policy.stepTwoCooldownSeconds) return wait("using_step_two");

  // V2.3 gates.
  if (ctx.stopped) return wait("member_preference_stop");
  if (tier === "reassess") return wait("reassess_no_more_proactive");
  if (ctx.selfReportedProgress && !ctx.ownConfusion) return wait("member_reports_progress");
  const groupDifficulty = groupDifficultyOf(ctx, la);
  const corroborated = ctx.ownConfusion || groupDifficulty;
  if (la.scaffolding.requireCorroboratedNeed && !corroborated) return wait("need_not_corroborated");
  if (tier === "no_offer" && !ctx.ownConfusion) return wait("faded_after_independent_work");

  const episodeStart =
    ctx.lastOwnContributionAt && ctx.lastOwnContributionAt > ctx.scenarioStartedAt
      ? ctx.lastOwnContributionAt
      : ctx.scenarioStartedAt;
  const pauseSeconds = Math.max(0, seconds(episodeStart, now));
  if (pauseSeconds < policy.minPauseSeconds && !ctx.ownConfusion) return wait("recently_active");

  const allowedArms = ADAPTIVE_ARMS.filter(
    (arm) => !ctx.usedTypes.includes(arm) && (ARM_LEVEL[arm] === 1 || tier === "moderate")
  );
  if (allowedArms.length === 0) return wait("no_suitable_help_left");

  const seed = decisionSeed(ctx, episodeStart, state);
  const rng = createRng(seed);
  // Same fixed draw order as V2, so decisions replay from the logged seed.
  const independence = sampleBeta(rng, state.independence.alpha, state.independence.beta);
  const receptiveness = sampleBeta(rng, state.receptiveness.alpha, state.receptiveness.beta);
  const armSamples = Object.fromEntries(
    ADAPTIVE_ARMS.map((arm) => [arm, sampleBeta(rng, state.arms[arm].alpha, state.arms[arm].beta)])
  ) as Record<AdaptiveArm, number>;

  const percentile = pausePercentile(state.pace, pauseSeconds);
  const struggle = 1 - independence;
  const pauseEvidence = percentile * struggle;
  const confusionEvidence = ctx.ownConfusion ? policy.confusionEvidence : 0;
  const groupEvidence = groupDifficulty ? policy.stallEvidence * struggle : 0;
  const need = 1 - (1 - pauseEvidence) * (1 - confusionEvidence) * (1 - groupEvidence);
  const score = need * receptiveness;

  const evidence: LearningAwareEvidence = {
    modelVersion: policy.modelVersion,
    seed,
    pauseSeconds: Math.round(pauseSeconds),
    pausePercentile: round(percentile),
    ownConfusion: ctx.ownConfusion,
    groupStalled: ctx.groupStalled,
    samples: {
      independence: round(independence),
      receptiveness: round(receptiveness),
      arms: {
        guiding_question: round(armSamples.guiding_question),
        hint: round(armSamples.hint),
        explanation: round(armSamples.explanation),
      },
    },
    need: round(need),
    score: round(score),
    threshold: policy.offerThreshold,
    allowedArms,
    posterior: summarizeState(state),
    tier,
    groupState: ctx.groupState,
    groupDifficulty,
    corroborated,
  };
  if (score < policy.offerThreshold) return wait("below_threshold", evidence);

  const arm = allowedArms.reduce((best, candidate) => (armSamples[candidate] > armSamples[best] ? candidate : best));
  const level = ARM_LEVEL[arm];
  const move: ScaffoldingMove = level === 2 ? "escalate" : "offer_minimal";
  return {
    action: "offer",
    reasonCode: "adaptive_private",
    arm,
    level,
    tier,
    move,
    evidence,
    rationale: buildRationale(arm, evidence),
    explanation: buildExplanation(evidence),
    proposal: {
      scope: "individual",
      memberId: ctx.participantId,
      move,
      supportType: arm,
      rationaleCode: ctx.ownConfusion ? "own_explicit_confusion" : "group_difficulty",
      evidence: [],
      policyVersion,
      confidence: round(score),
      safeToOffer: true,
    },
  };
}

function buildRationale(arm: AdaptiveArm, evidence: LearningAwareEvidence): string {
  const parts = [
    `need ${evidence.need} x receptiveness ${evidence.samples.receptiveness} = ${evidence.score} >= ${evidence.threshold}`,
    `tier ${evidence.tier}`,
  ];
  if (evidence.ownConfusion) parts.push("the member wrote that they were unsure");
  if (evidence.groupDifficulty) parts.push(`group state ${evidence.groupState}`);
  parts.push(
    `pause ${evidence.pauseSeconds}s is longer than ${Math.round(evidence.pausePercentile * 100)}% of this member's usual gaps`,
    `chose ${arm} (highest sampled effectiveness among ${evidence.allowedArms.join(", ")})`
  );
  return parts.join("; ");
}

/** Shown to the member behind "Why am I seeing this?". Never mentions other members. */
function buildExplanation(evidence: LearningAwareEvidence): string {
  const reasons: string[] = [];
  if (evidence.ownConfusion) reasons.push("You wrote that you were unsure.");
  if (evidence.groupDifficulty) reasons.push("Your group seems to be stuck at the moment.");
  return [
    ...reasons,
    "Only you can see this, and nothing is sent to the AI unless you click Yes.",
    "It starts with the smallest useful help and will not give you the answer.",
    "You can choose \"Don't suggest again in this scenario\" at any time; your own Step 2 help stays available.",
  ].join(" ");
}
