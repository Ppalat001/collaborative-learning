import policyData from "@/data/intervention-policies.json";

export type BetaPrior = [alpha: number, beta: number];

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
  return { version, ...body };
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
