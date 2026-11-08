import type { AdaptivePrivatePolicy } from "../policies";
import {
  ADAPTIVE_ARMS,
  ARM_LEVEL,
  pausePercentile,
  summarizeState,
  type AdaptiveArm,
  type LearnerState,
  type StateSummary,
} from "./LearnerModel";

/**
 * Decides whether to offer one member private help now, and which kind, by
 * Thompson sampling from that member's posteriors. Pure and deterministic for a
 * given seed, so every decision can be replayed from the logged evidence.
 *
 * The safety limits checked first are fixed rules; only what happens after them
 * is learned.
 */

export interface AdaptiveContext {
  participantId: string;
  scenarioOrder: number;
  now: string;
  online: boolean;
  submitted: boolean;
  /** When enough members were first connected to this scenario; null if not yet. */
  scenarioStartedAt: string | null;
  lastOwnContributionAt: string | null;
  /** The member's own unanswered message saying they are unsure. */
  ownConfusion: boolean;
  groupStalled: boolean;
  offersThisScenario: number;
  lastOfferAt: string | null;
  /** An offer is still waiting for an answer or being generated. */
  pendingOffer: boolean;
  lastStepTwoAt: string | null;
  /** Support types already opened in Step 2 or delivered by a popup in this scenario. */
  usedTypes: string[];
  /** Minimal help (hint or guiding question) was already received in this scenario. */
  lightHelpReceived: boolean;
}

export interface AdaptiveEvidence {
  modelVersion: string;
  seed: string;
  pauseSeconds: number;
  pausePercentile: number;
  ownConfusion: boolean;
  groupStalled: boolean;
  samples: {
    independence: number;
    receptiveness: number;
    arms: Record<AdaptiveArm, number>;
  };
  need: number;
  score: number;
  threshold: number;
  allowedArms: AdaptiveArm[];
  posterior: StateSummary;
}

export type AdaptiveDecision =
  | { action: "wait"; reasonCode: string; evidence: AdaptiveEvidence | null }
  | {
      action: "offer";
      reasonCode: "adaptive_private";
      arm: AdaptiveArm;
      level: 1 | 2;
      evidence: AdaptiveEvidence;
      /** For researchers. */
      rationale: string;
      /** Shown to the member behind "Why am I seeing this?". Never mentions other members. */
      explanation: string;
    };

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and reproducible across platforms. */
export function createRng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleNormal(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia-Tsang. */
function sampleGamma(rng: () => number, shape: number): number {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rng();
    return sampleGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(rng: () => number, alpha: number, beta: number): number {
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * One draw per pause episode: the seed only changes when the member contributes
 * again or the model is updated, so re-checking every few seconds does not give
 * extra chances to cross the threshold.
 */
export function decisionSeed(ctx: AdaptiveContext, episodeStart: string, state: LearnerState): string {
  return `${ctx.participantId}|${ctx.scenarioOrder}|${episodeStart}|${state.updates}`;
}

export function decideAdaptiveOffer(
  state: LearnerState,
  ctx: AdaptiveContext,
  policy: AdaptivePrivatePolicy
): AdaptiveDecision {
  const wait = (reasonCode: string, evidence: AdaptiveEvidence | null = null): AdaptiveDecision => ({
    action: "wait",
    reasonCode,
    evidence,
  });
  const { now } = ctx;

  if (ctx.submitted) return wait("scenario_submitted");
  if (!ctx.online) return wait("not_online");
  if (ctx.pendingOffer) return wait("offer_pending");
  if (ctx.offersThisScenario >= policy.maxOffersPerScenario) return wait("max_offers_reached");
  if (ctx.lastOfferAt && seconds(ctx.lastOfferAt, now) < policy.minSecondsBetweenOffers) {
    return wait("offer_cooldown");
  }
  if (!ctx.scenarioStartedAt || seconds(ctx.scenarioStartedAt, now) < policy.minSecondsIntoScenario) {
    return wait("scenario_just_started");
  }
  if (ctx.lastStepTwoAt && seconds(ctx.lastStepTwoAt, now) < policy.stepTwoCooldownSeconds) {
    return wait("using_step_two");
  }
  const episodeStart =
    ctx.lastOwnContributionAt && ctx.lastOwnContributionAt > ctx.scenarioStartedAt
      ? ctx.lastOwnContributionAt
      : ctx.scenarioStartedAt;
  const pauseSeconds = Math.max(0, seconds(episodeStart, now));
  if (pauseSeconds < policy.minPauseSeconds && !ctx.ownConfusion) return wait("recently_active");

  const allowedArms = ADAPTIVE_ARMS.filter(
    (arm) => !ctx.usedTypes.includes(arm) && (ARM_LEVEL[arm] === 1 || ctx.lightHelpReceived)
  );
  if (allowedArms.length === 0) return wait("no_suitable_help_left");

  const seed = decisionSeed(ctx, episodeStart, state);
  const rng = createRng(seed);
  // Fixed draw order keeps decisions reproducible from the seed.
  const independence = sampleBeta(rng, state.independence.alpha, state.independence.beta);
  const receptiveness = sampleBeta(rng, state.receptiveness.alpha, state.receptiveness.beta);
  const armSamples = Object.fromEntries(
    ADAPTIVE_ARMS.map((arm) => [arm, sampleBeta(rng, state.arms[arm].alpha, state.arms[arm].beta)])
  ) as Record<AdaptiveArm, number>;

  const percentile = pausePercentile(state.pace, pauseSeconds);
  const struggle = 1 - independence;
  // Inferred signals are discounted by how independent the member seems; an explicit "I'm unsure" is not.
  const pauseEvidence = percentile * struggle;
  const confusionEvidence = ctx.ownConfusion ? policy.confusionEvidence : 0;
  const stallEvidence = ctx.groupStalled ? policy.stallEvidence * struggle : 0;
  const need = 1 - (1 - pauseEvidence) * (1 - confusionEvidence) * (1 - stallEvidence);
  const score = need * receptiveness;

  const evidence: AdaptiveEvidence = {
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
  };
  if (score < policy.offerThreshold) return wait("below_threshold", evidence);

  const arm = allowedArms.reduce((best, candidate) => (armSamples[candidate] > armSamples[best] ? candidate : best));
  return {
    action: "offer",
    reasonCode: "adaptive_private",
    arm,
    level: ARM_LEVEL[arm],
    evidence,
    rationale: buildRationale(arm, evidence),
    explanation: buildExplanation(evidence, policy),
  };
}

function buildRationale(arm: AdaptiveArm, evidence: AdaptiveEvidence): string {
  const parts = [
    `need ${evidence.need} x receptiveness ${evidence.samples.receptiveness} = ${evidence.score} >= ${evidence.threshold}`,
    `pause ${evidence.pauseSeconds}s is longer than ${Math.round(evidence.pausePercentile * 100)}% of this member's usual gaps (typical ${Math.round(evidence.posterior.paceMedianSeconds)}s)`,
    `sampled independence ${evidence.samples.independence}`,
  ];
  if (evidence.ownConfusion) parts.push("the member wrote that they were unsure");
  if (evidence.groupStalled) parts.push("the group had stalled");
  parts.push(`chose ${arm} (highest sampled effectiveness among ${evidence.allowedArms.join(", ")})`);
  return parts.join("; ");
}

function buildExplanation(evidence: AdaptiveEvidence, policy: AdaptivePrivatePolicy): string {
  const reasons: string[] = [];
  if (evidence.ownConfusion) reasons.push("You wrote that you were unsure.");
  if (evidence.pausePercentile >= 0.5 && evidence.pauseSeconds >= policy.minPauseSeconds) {
    reasons.push("You have been quiet for longer than is usual for you in this session.");
  }
  if (evidence.groupStalled) reasons.push("Your group has paused for a little while.");
  if (reasons.length === 0) reasons.push("This might be a good moment for a small nudge.");
  return [
    ...reasons,
    "Only you can see this, and nothing is sent to the AI unless you click Yes.",
    "These suggestions learn from your answers: if you choose No thanks, you will be offered fewer.",
    "It will not give you the answer.",
  ].join(" ");
}
