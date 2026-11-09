import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkParticipantToken, issueParticipantToken } from "@/lib/auth/participantAuth";
import { AdaptiveScaffoldingEngine, type ParticipantHistory } from "@/lib/intervention/AdaptiveScaffoldingEngine";
import { getPolicy, listPolicyVersions } from "@/lib/intervention/policies";
import {
  capabilitiesFor,
  normalizeFeatures,
  ResearchConditionManager,
  STUDY_PROTOCOL,
} from "@/lib/intervention/ResearchConditionManager";
import { computeReadiness } from "@/lib/intervention/ResearchEligibilityGuard";
import { validateFacilitatorOutput, validatePrivateOfferOutput } from "@/lib/intervention/validators";
import {
  AI_SUPPORT_OPTIONS,
  PARTICIPANT_AI_SUPPORT_OPTIONS,
  isParticipantAiSupportType,
} from "@/lib/types";
import { getAssessment } from "@/lib/utils/assessment";
import { getScenarios } from "@/lib/utils/scenarios";

describe("Assessment instrument", () => {
  test("pre- and post-tests share one learning-application question as question 9", () => {
    const expected =
      "A group is stuck repeating the same arguments without progress. One member suggests asking AI for the full answer.\n\nWhat should AI do, who should receive the support, and how can the group remain responsible for the solution?";
    for (const type of ["pre", "post"] as const) {
      const assessment = getAssessment(type);
      assert.equal(assessment.questions.length, 8);
      assert.deepEqual(assessment.openQuestions, [
        { id: "open_ai_role", text: expected },
      ]);
    }
  });
});

describe("Scenario instrument", () => {
  test("contains the eight current research scenarios and no scenarios 9 or 10", () => {
    const scenarios = getScenarios();
    assert.deepEqual(
      scenarios.map(({ id, order, title, taskType }) => ({ id, order, title, taskType })),
      [
        { id: "scenario-01", order: 1, title: "Explaining a Concept", taskType: "explain" },
        { id: "scenario-02", order: 2, title: "Improving a Weak Answer", taskType: "expand_answer" },
        { id: "scenario-03", order: 3, title: "Short Case Study", taskType: "case_study" },
        { id: "scenario-04", order: 4, title: "Making a Judgment Call", taskType: "judgment" },
        { id: "scenario-05", order: 5, title: "Understanding Learning Regulation", taskType: "explain" },
        { id: "scenario-06", order: 6, title: "Reflecting on Meaningful Participation", taskType: "reflection" },
        { id: "scenario-07", order: 7, title: "Ethical Dilemma", taskType: "judgment" },
        { id: "scenario-08", order: 8, title: "Data Interpretation", taskType: "case_study" },
      ]
    );
    assert.match(scenarios[2].promptForGroup, /without taking control/);
    assert.match(scenarios[3].promptForGroup, /intervene now or wait/);
    assert.match(scenarios[4].promptForGroup, /without taking responsibility away/);
    assert.match(scenarios[7].promptForGroup, /alternative explanation/);
  });
});

describe("Participant AI support choices", () => {
  test("private collaboration options remain readable historically but are unavailable in the participant test", () => {
    const historicalTypes = AI_SUPPORT_OPTIONS.map((option) => option.type);
    const participantTypes = PARTICIPANT_AI_SUPPORT_OPTIONS.map((option) => option.type);

    assert.ok(historicalTypes.includes("summary"));
    assert.ok(historicalTypes.includes("task_splitting"));
    assert.ok(historicalTypes.includes("conflict_support"));
    assert.deepEqual(participantTypes, [
      "hint",
      "guiding_question",
      "explanation",
      "example",
      "feedback",
      "full_answer",
    ]);
    assert.equal(isParticipantAiSupportType("summary"), false);
    assert.equal(isParticipantAiSupportType("hint"), true);
  });
});

describe("ResearchConditionManager release gate", () => {
  test("with no settings at all, V2 is on and home-page groups get the facilitator plus adaptive private suggestions", () => {
    const result = new ResearchConditionManager({}).planAssignment({ createdVia: "home_page" });
    assert.ok(result.ok && result.plan);
    assert.equal(result.plan.researchCondition, "proactive_adaptive");
    assert.equal(result.plan.interventionPolicyVersion, "policy-v2-3");
    assert.equal(result.plan.assignmentMethod, "configured_default");
    assert.equal(result.plan.createdVia, "home_page");
    assert.equal(result.plan.minGroupSize, 2);
    assert.equal(result.plan.maxGroupSize, 4);
  });

  test("ADAPTIVE_V2_ENABLED=false keeps home-page groups legacy and refuses admin V2 creation", () => {
    const manager = new ResearchConditionManager({ ADAPTIVE_V2_ENABLED: "false" });
    assert.deepEqual(manager.planAssignment({ createdVia: "home_page" }), { ok: true, plan: null });
    const admin = manager.planAssignment({ createdVia: "admin", condition: "proactive_group" });
    assert.equal(admin.ok, false);
  });

  test("ADAPTIVE_V2_HOME_PAGE_GROUPS=legacy keeps home-page groups legacy but allows admin V2 groups", () => {
    const manager = new ResearchConditionManager({ ADAPTIVE_V2_HOME_PAGE_GROUPS: "legacy" });
    assert.deepEqual(manager.planAssignment({ createdVia: "home_page" }), { ok: true, plan: null });
    assert.equal(manager.planAssignment({ createdVia: "admin", condition: "proactive_group" }).ok, true);
  });

  test("the default condition can be changed", () => {
    const manager = new ResearchConditionManager({ ADAPTIVE_V2_DEFAULT_CONDITION: "shared_on_demand" });
    const result = manager.planAssignment({ createdVia: "home_page" });
    assert.ok(result.ok && result.plan);
    assert.equal(result.plan.researchCondition, "shared_on_demand");
  });

  test("the retired private-coach condition cannot be assigned to new groups", () => {
    const manager = new ResearchConditionManager({});
    const selected = manager.planAssignment({ createdVia: "admin", condition: "dual_adaptive" });
    assert.equal(selected.ok, false);

    const configured = new ResearchConditionManager({
      ADAPTIVE_V2_DEFAULT_CONDITION: "dual_adaptive",
    }).planAssignment({ createdVia: "home_page" });
    assert.ok(configured.ok && configured.plan);
    assert.equal(configured.plan.researchCondition, "proactive_adaptive");
  });

  test("proactive_adaptive enables adaptive private suggestions only; existing conditions never get them", () => {
    assert.equal(capabilitiesFor("proactive_adaptive").adaptivePrivate, true);
    assert.equal(capabilitiesFor("proactive_adaptive").proactiveGroup, true);
    assert.equal(capabilitiesFor("proactive_adaptive").proactivePrivate, false);
    for (const condition of ["baseline_private_request", "shared_on_demand", "proactive_group", "dual_adaptive"] as const) {
      assert.equal(capabilitiesFor(condition).adaptivePrivate, false, condition);
    }
  });

  test("proactive_adaptive cannot run on a policy without adaptive private settings", () => {
    const manager = new ResearchConditionManager({});
    const result = manager.planAssignment({ createdVia: "admin", condition: "proactive_adaptive", policyVersion: "policy-v2-1" });
    assert.equal(result.ok, false);
    const current = manager.planAssignment({ createdVia: "admin", condition: "proactive_adaptive" });
    assert.ok(current.ok && current.plan);
    assert.equal(current.plan.interventionPolicyVersion, "policy-v2-3");
  });

  test("ADAPTIVE_V2_POLICY_VERSION pins new groups of an ongoing cohort to policy-v2-2", () => {
    const pinned = new ResearchConditionManager({ ADAPTIVE_V2_POLICY_VERSION: "policy-v2-2" });
    const home = pinned.planAssignment({ createdVia: "home_page" });
    assert.ok(home.ok && home.plan);
    assert.equal(home.plan.interventionPolicyVersion, "policy-v2-2");
    assert.equal(home.plan.researchCondition, "proactive_adaptive");
    const explicit = pinned.planAssignment({ createdVia: "admin", condition: "proactive_group", policyVersion: "policy-v2-3" });
    assert.ok(explicit.ok && explicit.plan);
    assert.equal(explicit.plan.interventionPolicyVersion, "policy-v2-3");
  });

  test("policy-v2-2 is unchanged and policy-v2-3 keeps its group thresholds", () => {
    const v22 = getPolicy("policy-v2-2");
    const v23 = getPolicy("policy-v2-3");
    assert.equal(v22.learningAware, undefined);
    assert.equal(v22.adaptivePrivate?.modelVersion, "adaptive-bandit-v1");
    assert.equal(v23.testOnly, false);
    assert.equal(v23.learningAware?.groupOffers.dismissal, "per_member");
    for (const key of [
      "initialSilenceSeconds",
      "stallSeconds",
      "productiveWindowSeconds",
      "recentWindowSeconds",
      "disagreementPersistSeconds",
      "cooldownSeconds",
      "maxProactiveGroupPerScenario",
      "maxProactivePrivatePerParticipantPerScenario",
      "offerExpirySeconds",
      "deferSeconds",
    ] as const) {
      assert.equal(v23[key], v22[key], key);
    }
  });

  test("groups record every version and the condition", () => {
    const manager = new ResearchConditionManager({});
    const result = manager.planAssignment({ createdVia: "admin", condition: "proactive_group" });
    assert.ok(result.ok && result.plan);
    const plan = result.plan;
    assert.equal(plan.researchCondition, "proactive_group");
    assert.equal(plan.assignmentMethod, "researcher_selected");
    assert.equal(plan.consentVersion, STUDY_PROTOCOL.consent.version);
    assert.match(plan.scenarioSetVersion, /^scenarios-sha256-/);
    assert.match(plan.assessmentVersion, /^assessment-sha256-/);
    assert.equal(plan.aiModeAtAssignment, "mock");
  });

  test("test-only policies need an explicit flag", () => {
    const request = { createdVia: "admin" as const, condition: "proactive_group" as const, policyVersion: "policy-v2-test-accelerated" };
    assert.equal(new ResearchConditionManager({}).planAssignment(request).ok, false);
    assert.equal(
      new ResearchConditionManager({ ADAPTIVE_V2_ALLOW_TEST_POLICY: "true" }).planAssignment(request).ok,
      true
    );
    assert.equal(getPolicy("policy-v2-test-accelerated").testOnly, true);
    assert.ok(listPolicyVersions().includes("policy-v2-1"));
  });

  test("randomized assignment only draws from the configured list", () => {
    const manager = new ResearchConditionManager(
      {
        ADAPTIVE_V2_ASSIGNMENT: "randomized",
        ADAPTIVE_V2_RANDOMIZE_CONDITIONS: "shared_on_demand,dual_adaptive,not_a_condition",
      },
      (size) => size - 1
    );
    const result = manager.planAssignment({ createdVia: "admin" });
    assert.ok(result.ok && result.plan);
    assert.equal(result.plan.researchCondition, "shared_on_demand");
    assert.equal(result.plan.assignmentMethod, "randomized");
  });

  test("feature flags fall back to protocol defaults for invalid values", () => {
    const features = normalizeFeatures({ initialIdea: "sometimes" as never, roles: true });
    assert.equal(features.initialIdea, STUDY_PROTOCOL.defaultFeatures.initialIdea);
    assert.equal(features.roles, true);
  });
});

describe("Readiness gate", () => {
  const assignment = { minGroupSize: 2, maxGroupSize: 4, rosterFrozenAt: null, frozenRosterIds: null };
  const members = [
    { id: "a", displayName: "Ana" },
    { id: "b", displayName: "Ben" },
  ];

  test("every member must consent and finish the pre-test", () => {
    const status = computeReadiness({
      assignment,
      members,
      consents: [{ participantId: "a", withdrawnAt: null, droppedOutAt: null }],
      preTestParticipantIds: ["a"],
    });
    assert.equal(status.canStart, false);
    assert.ok(status.blockers.some((b) => b.includes("Ben has not given consent")));

    const ready = computeReadiness({
      assignment,
      members,
      consents: [
        { participantId: "a", withdrawnAt: null, droppedOutAt: null },
        { participantId: "b", withdrawnAt: null, droppedOutAt: null },
      ],
      preTestParticipantIds: ["a", "b"],
    });
    assert.equal(ready.canStart, true);
  });

  test("withdrawn members do not count; a group of one cannot start", () => {
    const status = computeReadiness({
      assignment,
      members,
      consents: [
        { participantId: "a", withdrawnAt: null, droppedOutAt: null },
        { participantId: "b", withdrawnAt: "2026-01-01T00:00:00.000Z", droppedOutAt: null },
      ],
      preTestParticipantIds: ["a"],
    });
    assert.equal(status.activeMemberCount, 1);
    assert.equal(status.canStart, false);
    assert.ok(status.blockers.some((b) => b.includes("At least 2 members")));
  });
});

describe("Participant tokens", () => {
  test("V2 groups require the device token; legacy groups keep the id-only rule", () => {
    const { token, hash } = issueParticipantToken();
    assert.equal(checkParticipantToken({ isV2: true, token, storedHash: hash }), "verified");
    assert.equal(checkParticipantToken({ isV2: true, token: null, storedHash: hash }), "rejected");
    assert.equal(checkParticipantToken({ isV2: true, token: "wrong", storedHash: hash }), "rejected");
    assert.equal(checkParticipantToken({ isV2: false, token: null, storedHash: hash }), "legacy_unverified");
    assert.equal(checkParticipantToken({ isV2: false, token: null, storedHash: null }), "legacy_unverified");
    assert.equal(checkParticipantToken({ isV2: false, token: "wrong", storedHash: hash }), "rejected");
  });
});

describe("Output validators", () => {
  const options = { maxChars: 1200, memberNames: ["Ana", "Ben"] };

  test("facilitator output may not give the answer, name members or single anyone out", () => {
    assert.equal(validateFacilitatorOutput("The correct answer is option B.", options).ok, false);
    assert.equal(validateFacilitatorOutput("Ana, what do you think?", options).ok, false);
    assert.equal(validateFacilitatorOutput("Member A hasn't said anything yet.", options).ok, false);
    assert.equal(validateFacilitatorOutput("x".repeat(1300), options).ok, false);
    assert.equal(validateFacilitatorOutput("   ", options).ok, false);
    const ok = validateFacilitatorOutput(
      "Try this: each of you writes one reason for your preferred option, then compare them.",
      options
    );
    assert.equal(ok.ok, true);
  });

  test("private hints may not hand over the answer", () => {
    assert.equal(validatePrivateOfferOutput("Here is the complete answer: ...", 600).ok, false);
    assert.equal(validatePrivateOfferOutput("Think about who carries the cost in each option.", 600).ok, true);
  });
});

describe("AdaptiveScaffoldingEngine (least intrusive first, with fading)", () => {
  const engine = new AdaptiveScaffoldingEngine();
  const current = { minimalSupportReceived: false, confusionAfterMinimal: false, explicitlyRequestedMore: false };
  const good = (scenarioOrder: number) => ({
    scenarioOrder,
    contributedBeforeAi: true,
    usedAi: true,
    maxContentLevel: 1,
    submitted: true,
  });

  test("starts with a hint", () => {
    const rec = engine.recommendLevel({ scenarioOrder: 1, previous: [], current }, 2);
    assert.equal(rec.level, 1);
    assert.equal(rec.supportType, "hint");
    assert.equal(rec.fadingApplied, false);
  });

  test("fades to a guiding question after independent work in the last scenarios", () => {
    const history: ParticipantHistory = { scenarioOrder: 3, previous: [good(1), good(2)], current };
    const rec = engine.recommendLevel(history, 2);
    assert.equal(rec.supportType, "guiding_question");
    assert.equal(rec.fadingApplied, true);
  });

  test("does not fade when more direct help was needed recently", () => {
    const history: ParticipantHistory = {
      scenarioOrder: 3,
      previous: [good(1), { ...good(2), maxContentLevel: 3 }],
      current,
    };
    assert.equal(engine.recommendLevel(history, 2).fadingApplied, false);
  });

  test("escalates to level 2 only after minimal help and continued difficulty, never to level 3", () => {
    const escalated = engine.recommendLevel(
      { scenarioOrder: 1, previous: [], current: { ...current, minimalSupportReceived: true, confusionAfterMinimal: true } },
      2
    );
    assert.equal(escalated.level, 2);
    assert.equal(escalated.supportType, "explanation");
    const requestedWithoutHelp = engine.recommendLevel(
      { scenarioOrder: 1, previous: [], current: { ...current, explicitlyRequestedMore: true } },
      2
    );
    assert.equal(requestedWithoutHelp.level, 1);
  });
});
