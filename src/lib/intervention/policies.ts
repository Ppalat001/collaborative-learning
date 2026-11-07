import policyData from "@/data/intervention-policies.json";

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
  return { version, ...body };
}

const versions = policyData.versions as Record<string, PolicyBody>;
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
