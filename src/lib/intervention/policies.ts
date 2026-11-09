import policyData from "@/data/intervention-policies.json";
import type { InterventionTrigger } from "./types";

export type BetaPrior = [alpha: number, beta: number];

/** Triggers that can lead to a proactive group offer at all (group process situations). */
const GROUP_OFFER_TRIGGERS: InterventionTrigger[] = [
  "initial_silence",
  "stalled_discussion",
  "explicit_confusion",
  "unresolved_disagreement",
  "possible_participation_imbalance",
  "coordination_request",
];

/**
 * Settings for the per-member learning model behind private popup offers. The
 * priors are the same starting point for every member; the safety limits are
 * fixed rules that the learning never changes.
 */
export interface AdaptivePrivatePolicy {
  modelVersion: string;
  maxOffersPerScenario: number;
  minSecondsBetweenOffers: number;
  minSecondsIntoScenario: number;
  minPauseSeconds: number;
  stepTwoCooldownSeconds: number;
  offerExpirySeconds: number;
  outcomeWindowSeconds: number;
  /** Own contributions closer together than this count as one burst of activity. */
  burstMergeSeconds: number;
  /** Longer gaps are capped before they update the pace estimate. */
  maxGapSeconds: number;
  offerThreshold: number;
  confusionEvidence: number;
  stallEvidence: number;
  priors: {
    paceMedianSeconds: number;
    paceLogSd: number;
    pacePseudoObservations: number;
    independenceStrength: number;
    receptiveness: BetaPrior;
    arms: { guiding_question: BetaPrior; hint: BetaPrior; explanation: BetaPrior };
  };
  weights: {
    accepted: number;
    dismissed: number;
    deferred: number;
    expired: number;
    helpSucceeded: number;
    helpFailed: number;
    independentScenario: number;
    directHelpScenario: number;
    surveyTooMuch: number;
    surveyTooLittle: number;
    surveyAboutRight: number;
  };
}

/** Reward weights for the V2.3 learner rules (`reward-v2-3`); see BanditRewardPolicy. */
export interface LearningAwareRewards {
  rewardVersion: string;
  accepted: number;
  dismissed: number;
  deferred: number;
  feedbackYes: number;
  /** "Partly" adds this much to both alpha and beta (a fractional pseudo-count). */
  feedbackPartly: number;
  feedbackNo: number;
  /** Arm update from a corroborated observed outcome, when no explicit feedback exists. */
  observedOutcome: number;
  activityResponse: number;
  independentScenario: number;
  notNeeded: number;
  helpUseful: number;
  selfReportedDifficulty: number;
  surveyTooMuch: number;
  surveyTooLittle: number;
  surveyAboutRight: number;
}

/**
 * The V2.3 learning-aware extension. Present only on policy-v2-3 and later;
 * groups on older policies keep their original behaviour.
 */
export interface LearningAwarePolicy {
  engineVersion: string;
  estimatorVersion: string;
  evaluatorVersion: string;
  scaffoldingVersion: string;
  contextGate: { minConfidenceToAct: number };
  estimator: {
    progressWindowSeconds: number;
    /** Token-overlap above which two messages count as the same statement. */
    repetitionSimilarity: number;
    minRepeatedMessagesForLoop: number;
    loopMinSeconds: number;
    staleEvidenceSeconds: number;
    answerSynthesisMinChars: number;
  };
  classifier: { enabled: boolean; timeoutMs: number; minConfidence: number; minSecondsBetweenCalls: number };
  groupOffers: {
    dismissal: "per_member";
    /**
     * policy-unified-1 and later: the only reasons for a proactive group offer.
     * Its presence also keeps offers away while a member is confirming the final
     * answer, while a group AI reply is being generated, and for `cooldownSeconds`
     * after a manual group AI request. Absent on policy-v2-3, which keeps its rules.
     */
    proactiveTriggers?: InterventionTrigger[];
  };
  outcome: { windowSeconds: number; confoundWindowSeconds: number };
  feedback: { enabled: boolean; promptDelaySeconds: number };
  scaffolding: { fadeAfterIndependentScenarios: number; requireCorroboratedNeed: boolean };
  exposure: { maxClientClockSkewSeconds: number; maxEventsPerMinute: number };
  rewards: LearningAwareRewards;
}

export interface InterventionPolicy {
  version: string;
  status: string;
  testOnly: boolean;
  minActiveMembersForGroupTriggers: number;
  initialSilenceSeconds: number;
  stallSeconds: number;
  productiveWindowSeconds: number;
  recentWindowSeconds: number;
  disagreementPersistSeconds: number;
  cooldownSeconds: number;
  maxProactiveGroupPerScenario: number;
  maxProactivePrivatePerParticipantPerScenario: number;
  imbalanceMinMessages: number;
  imbalanceMinActiveSeconds: number;
  imbalanceTopShare: number;
  evaluationDebounceMs: number;
  deferSeconds: number;
  offerExpirySeconds: number;
  maxManualGroupRequestsPerScenario: number;
  manualRequestCooldownSeconds: number;
  /** "I'm stuck" requests per member and scenario (dual_adaptive only). */
  maxPersonalRequestsPerScenario: number;
  fadingLookbackScenarios: number;
  shadowMonitoringInPassiveConditions: boolean;
  classifier: { enabled: boolean; timeoutMs: number; minConfidence: number };
  facilitator: {
    maxTranscriptMessages: number;
    maxTranscriptChars: number;
    maxAnswerChars: number;
    maxOutputTokens: number;
    maxOutputChars: number;
    timeoutMs: number;
  };
  /** Only in policies that support the proactive_adaptive condition. */
  adaptivePrivate?: AdaptivePrivatePolicy;
  learningAware?: LearningAwarePolicy;
}

type PolicyBody = Omit<InterventionPolicy, "version">;

const NUMERIC_KEYS: (keyof PolicyBody)[] = [
  "minActiveMembersForGroupTriggers",
  "initialSilenceSeconds",
  "stallSeconds",
  "productiveWindowSeconds",
  "recentWindowSeconds",
  "disagreementPersistSeconds",
  "cooldownSeconds",
  "maxProactiveGroupPerScenario",
  "maxProactivePrivatePerParticipantPerScenario",
  "imbalanceMinMessages",
  "imbalanceMinActiveSeconds",
  "imbalanceTopShare",
  "evaluationDebounceMs",
  "deferSeconds",
  "offerExpirySeconds",
  "maxManualGroupRequestsPerScenario",
  "manualRequestCooldownSeconds",
  "maxPersonalRequestsPerScenario",
  "fadingLookbackScenarios",
];

function validatePolicy(version: string, body: PolicyBody): InterventionPolicy {
  for (const key of NUMERIC_KEYS) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Intervention policy ${version}: ${String(key)} must be a non-negative number`);
    }
  }
  if (body.imbalanceTopShare > 1) {
    throw new Error(`Intervention policy ${version}: imbalanceTopShare must be at most 1`);
  }
  if (body.adaptivePrivate) validateAdaptive(version, body.adaptivePrivate);
  if (body.learningAware) validateLearningAware(version, body.learningAware, Boolean(body.adaptivePrivate));
  return { version, ...body };
}

function validateLearningAware(version: string, la: LearningAwarePolicy, hasAdaptive: boolean) {
  const fail = (message: string) => {
    throw new Error(`Intervention policy ${version}: learningAware.${message}`);
  };
  for (const key of ["engineVersion", "estimatorVersion", "evaluatorVersion", "scaffoldingVersion"] as const) {
    if (typeof la[key] !== "string" || !la[key]) fail(`${key} is required`);
  }
  if (typeof la.rewards?.rewardVersion !== "string" || !la.rewards.rewardVersion) fail("rewards.rewardVersion is required");
  const rewardWeights = Object.entries(la.rewards).filter(([k]) => k !== "rewardVersion");
  const numeric: [string, unknown][] = [
    ["contextGate.minConfidenceToAct", la.contextGate?.minConfidenceToAct],
    ...Object.entries(la.estimator ?? {}).map(([k, v]) => [`estimator.${k}`, v] as [string, unknown]),
    ["classifier.timeoutMs", la.classifier?.timeoutMs],
    ["classifier.minConfidence", la.classifier?.minConfidence],
    ["classifier.minSecondsBetweenCalls", la.classifier?.minSecondsBetweenCalls],
    ["outcome.windowSeconds", la.outcome?.windowSeconds],
    ["outcome.confoundWindowSeconds", la.outcome?.confoundWindowSeconds],
    ["feedback.promptDelaySeconds", la.feedback?.promptDelaySeconds],
    ["scaffolding.fadeAfterIndependentScenarios", la.scaffolding?.fadeAfterIndependentScenarios],
    ["exposure.maxClientClockSkewSeconds", la.exposure?.maxClientClockSkewSeconds],
    ["exposure.maxEventsPerMinute", la.exposure?.maxEventsPerMinute],
    ...rewardWeights.map(([k, v]) => [`rewards.${k}`, v] as [string, unknown]),
  ];
  for (const [key, value] of numeric) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${key} must be a non-negative number`);
  }
  for (const [key, value] of [
    ["contextGate.minConfidenceToAct", la.contextGate.minConfidenceToAct],
    ["estimator.repetitionSimilarity", la.estimator.repetitionSimilarity],
    ["classifier.minConfidence", la.classifier.minConfidence],
  ] as const) {
    if (value > 1) fail(`${key} must be at most 1`);
  }
  for (const [key, value] of [
    ["classifier.enabled", la.classifier.enabled],
    ["feedback.enabled", la.feedback.enabled],
    ["scaffolding.requireCorroboratedNeed", la.scaffolding.requireCorroboratedNeed],
  ] as const) {
    if (typeof value !== "boolean") fail(`${key} must be true or false`);
  }
  if (la.groupOffers?.dismissal !== "per_member") fail('groupOffers.dismissal must be "per_member"');
  const triggers = la.groupOffers.proactiveTriggers;
  if (
    triggers !== undefined &&
    (!Array.isArray(triggers) || triggers.length === 0 || !triggers.every((t) => GROUP_OFFER_TRIGGERS.includes(t)))
  ) {
    fail("groupOffers.proactiveTriggers must list group triggers");
  }
  if (!hasAdaptive) fail("requires adaptivePrivate settings");
}

/** The V2.3 settings of a policy, or null for policies that predate V2.3. */
export function learningAwareOf(policy: InterventionPolicy | null | undefined): LearningAwarePolicy | null {
  return policy?.learningAware ?? null;
}

/**
 * The final unified group-offer rules (policy-unified-1 and later), or null for
 * older policies, whose groups keep the rules they were created with.
 */
export function unifiedGroupRulesOf(
  policy: InterventionPolicy | null | undefined
): { proactiveTriggers: InterventionTrigger[] } | null {
  const triggers = policy?.learningAware?.groupOffers.proactiveTriggers;
  return triggers ? { proactiveTriggers: triggers } : null;
}

function validateAdaptive(version: string, adaptive: AdaptivePrivatePolicy) {
  const fail = (message: string) => {
    throw new Error(`Intervention policy ${version}: adaptivePrivate.${message}`);
  };
  const { priors, weights, modelVersion, ...limits } = adaptive;
  if (typeof modelVersion !== "string" || !modelVersion) fail("modelVersion is required");
  for (const [key, value] of [...Object.entries(limits), ...Object.entries(weights)]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${key} must be a non-negative number`);
  }
  for (const key of ["offerThreshold", "confusionEvidence", "stallEvidence"] as const) {
    if (adaptive[key] > 1) fail(`${key} must be at most 1`);
  }
  if (!(priors.paceMedianSeconds > 0) || !(priors.paceLogSd > 0) || !(priors.pacePseudoObservations > 0)) {
    fail("pace priors must be positive");
  }
  if (!(priors.independenceStrength >= 0)) fail("priors.independenceStrength must be non-negative");
  const betas: [string, BetaPrior][] = [["receptiveness", priors.receptiveness], ...Object.entries(priors.arms)];
  for (const [name, prior] of betas) {
    if (!Array.isArray(prior) || prior.length !== 2 || !prior.every((v) => typeof v === "number" && v >= 1)) {
      fail(`priors ${name} must be [alpha, beta] with both at least 1`);
    }
  }
}

// JSON arrays are typed as number[]; validatePolicy checks the [alpha, beta] shape at load time.
const versions = policyData.versions as unknown as Record<string, PolicyBody>;
const POLICIES = new Map<string, InterventionPolicy>(
  Object.entries(versions).map(([version, body]) => [version, validatePolicy(version, body)])
);

export const CURRENT_POLICY_VERSION: string = policyData.current;

if (!POLICIES.has(CURRENT_POLICY_VERSION)) {
  throw new Error(`Current intervention policy ${CURRENT_POLICY_VERSION} is not defined`);
}

/** Policies are looked up by the version stored on the group, so later edits never change old groups. */
export function getPolicy(version: string): InterventionPolicy {
  const policy = POLICIES.get(version);
  if (!policy) throw new Error(`Unknown intervention policy version: ${version}`);
  return policy;
}

export function hasPolicy(version: string): boolean {
  return POLICIES.has(version);
}

export function listPolicyVersions(): string[] {
  return [...POLICIES.keys()];
}
