import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkParticipantToken, issueParticipantToken } from "@/lib/auth/participantAuth";
import { AdaptiveScaffoldingEngine, type ParticipantHistory } from "@/lib/intervention/AdaptiveScaffoldingEngine";
import { getPolicy, listPolicyVersions } from "@/lib/intervention/policies";
import {
  normalizeFeatures,
  ResearchConditionManager,
  STUDY_PROTOCOL,
} from "@/lib/intervention/ResearchConditionManager";
import { computeReadiness } from "@/lib/intervention/ResearchEligibilityGuard";
import { validateFacilitatorOutput, validatePrivateOfferOutput } from "@/lib/intervention/validators";

describe("ResearchConditionManager release gate", () => {
  test("with no settings at all, V2 is on and home-page groups are dual_adaptive V2 groups", () => {
    const result = new ResearchConditionManager({}).planAssignment({ createdVia: "home_page" });
    assert.ok(result.ok && result.plan);
    assert.equal(result.plan.researchCondition, "dual_adaptive");
    assert.equal(result.plan.assignmentMethod, "configured_default");
    assert.equal(result.plan.createdVia, "home_page");
    assert.equal(result.plan.minGroupSize, 2);
    assert.equal(result.plan.maxGroupSize, 4);
  });

  test("ADAPTIVE_V2_ENABLED=false keeps home-page groups legacy and refuses admin V2 creation", () => {
    const manager = new ResearchConditionManager({ ADAPTIVE_V2_ENABLED: "false" });
    assert.deepEqual(manager.planAssignment({ createdVia: "home_page" }), { ok: true, plan: null });
    const admin = manager.planAssignment({ createdVia: "admin", condition: "dual_adaptive" });
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
    assert.equal(result.plan.researchCondition, "dual_adaptive");
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
