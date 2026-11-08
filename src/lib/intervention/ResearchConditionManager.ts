import { createHash, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import assessmentData from "@/data/assessment.json";
import scenariosData from "@/data/scenarios.json";
import protocol from "@/data/study-protocol.json";
import { describeModelConfig } from "@/lib/ai/provider";
import { db, schema } from "@/lib/db";
import { CURRENT_POLICY_VERSION, getPolicy, hasPolicy } from "@/lib/intervention/policies";
import {
  ASSIGNABLE_RESEARCH_CONDITIONS,
  RESEARCH_CONDITIONS,
  isAssignableResearchCondition,
  isResearchCondition,
  type AssignableResearchCondition,
  type ConditionCapabilities,
  type InstrumentMode,
  type ResearchCondition,
  type StudyFeatures,
} from "@/lib/intervention/types";

export type StudyAssignment = typeof schema.studyAssignments.$inferSelect;
export type AssignmentPlan = Omit<
  typeof schema.studyAssignments.$inferInsert,
  "id" | "sessionId" | "assignedAt" | "rosterFrozenAt" | "frozenRosterIds" | "startedBy"
>;

/** Feature matrix from the protocol; baseline equals the original private-request platform. */
export const CONDITION_CAPABILITIES: Record<ResearchCondition, ConditionCapabilities> = {
  baseline_private_request: {
    privateManual: true,
    sharedManual: false,
    proactiveGroup: false,
    proactivePrivate: false,
    fading: false,
    sharing: false,
  },
  shared_on_demand: {
    privateManual: true,
    sharedManual: true,
    proactiveGroup: false,
    proactivePrivate: false,
    fading: false,
    sharing: true,
  },
  proactive_group: {
    privateManual: true,
    sharedManual: true,
    proactiveGroup: true,
    proactivePrivate: false,
    fading: false,
    sharing: true,
  },
  dual_adaptive: {
    privateManual: true,
    sharedManual: true,
    proactiveGroup: true,
    // Retained as a stored historical condition, but the private coach is removed.
    proactivePrivate: false,
    fading: false,
    sharing: true,
  },
};

export function capabilitiesFor(condition: ResearchCondition): ConditionCapabilities {
  return CONDITION_CAPABILITIES[condition];
}

export interface V2ReleaseConfig {
  enabled: boolean;
  homePageGroups: "legacy" | "v2";
  defaultCondition: AssignableResearchCondition;
  assignment: "fixed" | "randomized";
  randomizeConditions: AssignableResearchCondition[];
  allowTestPolicy: boolean;
}

function parseConditions(value: string | undefined): AssignableResearchCondition[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(isAssignableResearchCondition);
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Release flags. V2 is on by default: every new group, including groups created
 * on the home page, is a V2 group. ADAPTIVE_V2_ENABLED=false brings back legacy groups.
 */
export function readReleaseConfig(env: EnvSource = process.env): V2ReleaseConfig {
  const defaultCondition = env.ADAPTIVE_V2_DEFAULT_CONDITION?.trim();
  return {
    enabled: env.ADAPTIVE_V2_ENABLED?.trim() !== "false",
    homePageGroups: env.ADAPTIVE_V2_HOME_PAGE_GROUPS?.trim() === "legacy" ? "legacy" : "v2",
    defaultCondition: isAssignableResearchCondition(defaultCondition) ? defaultCondition : "proactive_group",
    assignment: env.ADAPTIVE_V2_ASSIGNMENT?.trim() === "randomized" ? "randomized" : "fixed",
    randomizeConditions: parseConditions(env.ADAPTIVE_V2_RANDOMIZE_CONDITIONS),
    allowTestPolicy: env.ADAPTIVE_V2_ALLOW_TEST_POLICY?.trim() === "true",
  };
}

function contentVersion(prefix: string, value: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
  return `${prefix}-sha256-${hash}`;
}

/** Content hashes, so any unrecorded edit to the instruments shows up as a new version. */
export const SCENARIO_SET_VERSION = contentVersion("scenarios", scenariosData);
export const ASSESSMENT_VERSION = contentVersion("assessment", assessmentData);

export const STUDY_PROTOCOL = protocol;

const INSTRUMENT_MODES: InstrumentMode[] = ["off", "optional", "required"];

export function normalizeFeatures(overrides?: Partial<StudyFeatures> | null): StudyFeatures {
  const base = protocol.defaultFeatures as StudyFeatures;
  const pickMode = (value: unknown, fallback: InstrumentMode) =>
    INSTRUMENT_MODES.includes(value as InstrumentMode) ? (value as InstrumentMode) : fallback;
  return {
    openingPrompt:
      typeof overrides?.openingPrompt === "boolean" ? overrides.openingPrompt : base.openingPrompt,
    checkpoints:
      typeof overrides?.checkpoints === "boolean" ? overrides.checkpoints : base.checkpoints,
    roles: typeof overrides?.roles === "boolean" ? overrides.roles : base.roles,
    initialIdea: pickMode(overrides?.initialIdea, base.initialIdea),
    agreementReason: pickMode(overrides?.agreementReason, base.agreementReason),
  };
}

export interface AssignmentRequest {
  createdVia: "admin" | "home_page";
  condition?: ResearchCondition;
  policyVersion?: string;
  features?: Partial<StudyFeatures>;
  /** Internal only: lets automated tests exercise assignments that already exist historically. */
  allowRetiredCondition?: boolean;
}

export type PlanResult =
  | { ok: true; plan: AssignmentPlan | null }
  | { ok: false; error: string };

export class ConditionNotAllowedError extends Error {
  status = 403;
}

export class ResearchConditionManager {
  constructor(
    private readonly env: EnvSource = process.env,
    private readonly pickIndex: (size: number) => number = (size) => randomInt(size)
  ) {}

  /**
   * Decides how a new group is created. `plan: null` means a legacy group (only
   * when V2 is switched off, or home-page groups are set back to legacy).
   */
  planAssignment(request: AssignmentRequest): PlanResult {
    const config = readReleaseConfig(this.env);
    if (!config.enabled) {
      if (request.createdVia === "admin") {
        return { ok: false, error: "Adaptive Scaffolding V2 is disabled (ADAPTIVE_V2_ENABLED)" };
      }
      return { ok: true, plan: null };
    }
    if (request.createdVia === "home_page" && config.homePageGroups === "legacy") {
      return { ok: true, plan: null };
    }

    let condition: ResearchCondition;
    let assignmentMethod: string;
    if (request.condition) {
      condition = request.condition;
      assignmentMethod = "researcher_selected";
    } else if (config.assignment === "randomized") {
      if (config.randomizeConditions.length === 0) {
        return { ok: false, error: "ADAPTIVE_V2_RANDOMIZE_CONDITIONS lists no valid conditions" };
      }
      condition = config.randomizeConditions[this.pickIndex(config.randomizeConditions.length)];
      assignmentMethod = "randomized";
    } else {
      condition = config.defaultCondition;
      assignmentMethod = "configured_default";
    }

    if (!isAssignableResearchCondition(condition) && !request.allowRetiredCondition) {
      return {
        ok: false,
        error: "The private AI coach condition is retired and cannot be assigned to new groups",
      };
    }

    const policyVersion = request.policyVersion ?? CURRENT_POLICY_VERSION;
    if (!hasPolicy(policyVersion)) {
      return { ok: false, error: `Unknown intervention policy ${policyVersion}` };
    }
    const policy = getPolicy(policyVersion);
    const model = describeModelConfig();

    if (policy.testOnly && !config.allowTestPolicy) {
      return {
        ok: false,
        error: `Policy ${policyVersion} is test-only (ADAPTIVE_V2_ALLOW_TEST_POLICY)`,
      };
    }

    return {
      ok: true,
      plan: {
        researchCondition: condition,
        assignmentMethod,
        createdVia: request.createdVia,
        studyProtocolVersion: protocol.protocolVersion,
        consentVersion: protocol.consent.version,
        informationSheetVersion: protocol.consent.informationSheetVersion,
        scenarioSetVersion: SCENARIO_SET_VERSION,
        assessmentVersion: ASSESSMENT_VERSION,
        interventionPolicyVersion: policyVersion,
        modelConfigVersion: model.version,
        aiModeAtAssignment: model.aiMode,
        minGroupSize: protocol.groupSize.min,
        maxGroupSize: protocol.groupSize.max,
        features: normalizeFeatures(request.features),
      },
    };
  }

  async getAssignment(sessionId: string): Promise<StudyAssignment | null> {
    const [row] = await db
      .select()
      .from(schema.studyAssignments)
      .where(eq(schema.studyAssignments.sessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async getCondition(sessionId: string): Promise<ResearchCondition | null> {
    const assignment = await this.getAssignment(sessionId);
    return assignment ? conditionOf(assignment) : null;
  }

  enforceCondition(
    assignment: StudyAssignment | null,
    capability: keyof ConditionCapabilities
  ): ResearchCondition {
    if (!assignment) {
      throw new ConditionNotAllowedError("This feature is not part of this group's study design");
    }
    const condition = conditionOf(assignment);
    if (!CONDITION_CAPABILITIES[condition][capability]) {
      throw new ConditionNotAllowedError("This feature is not part of this group's study design");
    }
    return condition;
  }

  getProtocolVersion(): string {
    return protocol.protocolVersion;
  }
}

export function conditionOf(assignment: StudyAssignment): ResearchCondition {
  const condition = assignment.researchCondition;
  if (!isResearchCondition(condition)) {
    throw new Error(`Stored research condition is invalid: ${condition}`);
  }
  return condition;
}

export const conditionManager = new ResearchConditionManager();

export { ASSIGNABLE_RESEARCH_CONDITIONS, RESEARCH_CONDITIONS };
