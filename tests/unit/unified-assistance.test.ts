import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { buildGroupTimeline, groupAiKind } from "@/lib/groupTimeline";
import { CollaborationMonitor } from "@/lib/intervention/CollaborationMonitor";
import { estimatorAssessments, groupStateEstimator } from "@/lib/intervention/GroupStateEstimator";
import { decisionEngine, type DecisionContext } from "@/lib/intervention/InterventionDecisionEngine";
import { manualCooldownRemaining } from "@/lib/intervention/InterventionOrchestrator";
import { getPolicy, type InterventionPolicy } from "@/lib/intervention/policies";
import { capabilitiesFor } from "@/lib/intervention/ResearchConditionManager";
import type {
  CollaborationSnapshot,
  DiscussionEntry,
  InterventionAssessment,
  InterventionTrigger,
  InterventionView,
  ResearchCondition,
} from "@/lib/intervention/types";
import type { DiscussionMessage } from "@/lib/types";
import { isoAt, makeSnapshot } from "../helpers/fixtures";

const NOW = "2026-01-01T10:00:00.000Z";
const UNIFIED = getPolicy("policy-unified-1-test-accelerated");
const V23 = getPolicy("policy-v2-3-test-accelerated");

function msg(id: string, participantId: string, text: string, secondsAgo: number): DiscussionEntry {
  return { id, participantId, text, createdAt: isoAt(NOW, -secondsAgo) };
}

function snap(discussion: DiscussionEntry[], overrides: Partial<CollaborationSnapshot> = {}): CollaborationSnapshot {
  const last = [...discussion].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  return makeSnapshot({
    activeParticipantIds: ["p1", "p2"],
    onlineParticipantIds: ["p1", "p2"],
    startedAt: isoAt(NOW, -60),
    discussion,
    lastHumanMessageAt: last?.createdAt,
    now: NOW,
    ...overrides,
  });
}

function ctx(policy: InterventionPolicy, overrides: Partial<DecisionContext> = {}, condition: ResearchCondition = "proactive_group"): DecisionContext {
  return {
    condition,
    capabilities: capabilitiesFor(condition),
    policy,
    allConsented: true,
    proactiveGroupCount: 0,
    lastProactiveAt: null,
    privateOfferCounts: {},
    openGroupOffer: false,
    openPrivateOfferFor: [],
    dismissedTriggers: [],
    ...overrides,
  };
}

/** Monitor, group-state estimate and decision, as the orchestrator runs them. */
async function decide(snapshot: CollaborationSnapshot, overrides: Partial<DecisionContext> = {}, policy = UNIFIED) {
  const result = await new CollaborationMonitor(policy).evaluate(snapshot);
  const state = groupStateEstimator.estimate({ groupCode: "G1", snapshot, edits: [], checkpoints: [], policy });
  const assessments = [...result.assessments, ...estimatorAssessments(state, result.assessments, result.progress.state)];
  return decisionEngine.decide(snapshot, assessments, ctx(policy, { groupState: state, ...overrides }));
}

function assessment(trigger: InterventionTrigger): InterventionAssessment {
  return {
    trigger,
    evidenceMessageIds: ["m1"],
    evidenceSummary: `test ${trigger}`,
    confidence: 0.9,
    progressState: "unclear",
    source: "deterministic_rule",
  };
}

const QUIET = () => snap([], { startedAt: isoAt(NOW, -10) });

const REPEATING_LOOP = [
  msg("m1", "p1", "Option A is better because privacy protects the patients", 40),
  msg("m2", "p2", "I disagree, option B is better for the hospital budget", 36),
  msg("m3", "p1", "No, option A is better because privacy protects the patients", 25),
  msg("m4", "p2", "I disagree, option B is better for the hospital budget", 20),
  msg("m5", "p1", "Option A is better because privacy protects the patients", 5),
];

const PRODUCTIVE_DISAGREEMENT = [
  msg("m1", "p1", "I think option A is better because it protects the patients privacy", 20),
  msg("m2", "p2", "I disagree, option B is stronger because the hospital budget matters more", 15),
  msg("m3", "p1", "But what about long-term trust? For example people stop sharing data", 10),
  msg("m4", "p2", "No, the evidence shows budgets decide which clinics stay open next year", 2),
];

describe("Proactive group offers: only two reasons (policy-unified-1)", () => {
  test("B10/B13: a quiet group and a group going in circles may each get an offer", async () => {
    const quiet = await decide(QUIET());
    assert.equal(quiet.action, "offer");
    assert.equal(quiet.scope, "group");
    assert.equal(quiet.trigger, "initial_silence");

    const loop = await decide(snap(REPEATING_LOOP));
    assert.equal(loop.action, "offer");
    assert.equal(loop.trigger, "unresolved_disagreement");
    assert.equal(loop.supportType, "disagreement_mediation");
  });

  test("B12/B17: constructive disagreement and uncertain evidence lead to silence", async () => {
    const productive = await decide(snap(PRODUCTIVE_DISAGREEMENT));
    assert.equal(productive.action, "no_action");
    assert.equal(productive.reasonCode, "context_constructive_disagreement");

    const thinking = await decide(snap([msg("m1", "p1", "let me think about the second part", 8)]));
    assert.equal(thinking.action, "no_action");
    assert.equal(thinking.reasonCode, "context_gate_uncertain");
  });

  test("confusion, coordination questions and participation imbalance never trigger a group offer", () => {
    for (const trigger of ["explicit_confusion", "coordination_request", "possible_participation_imbalance"] as const) {
      const decision = decisionEngine.decide(snap([]), [assessment(trigger)], ctx(UNIFIED));
      assert.equal(decision.action, "no_action", trigger);
      assert.equal(decision.reasonCode, "not_a_proactive_group_reason", trigger);
    }
  });

  test("an unsupported reason does not hide why a supported one was held back", () => {
    const decision = decisionEngine.decide(
      snap([]),
      [assessment("explicit_confusion"), assessment("stalled_discussion")],
      ctx(UNIFIED, { openGroupOffer: true })
    );
    assert.equal(decision.trigger, "stalled_discussion");
    assert.equal(decision.reasonCode, "offer_pending");
  });

  test("B14: at most one proactive group offer per scenario, counting an expired one", async () => {
    const second = await decide(QUIET(), { proactiveGroupCount: 1 });
    assert.equal(second.action, "no_action");
    assert.equal(second.reasonCode, "max_prompts_reached");
  });

  test("no offer while a member confirms the final answer, while group AI is generating, or right after a manual request", async () => {
    const finalising = await decide(snap([], { startedAt: isoAt(NOW, -10), readyParticipantIds: ["p1"] }));
    assert.equal(finalising.reasonCode, "final_answer_in_progress");

    const generating = await decide(QUIET(), { groupGenerationInProgress: true });
    assert.equal(generating.reasonCode, "group_ai_generating");

    const justAsked = await decide(QUIET(), { lastManualGroupAt: isoAt(NOW, -(UNIFIED.cooldownSeconds - 1)) });
    assert.equal(justAsked.reasonCode, "recent_manual_group_request");
    const later = await decide(QUIET(), { lastManualGroupAt: isoAt(NOW, -(UNIFIED.cooldownSeconds + 1)) });
    assert.equal(later.action, "offer");

    const submitted = await decide(snap([], { startedAt: isoAt(NOW, -10), submitted: true }));
    assert.equal(submitted.reasonCode, "scenario_submitted");
  });

  test("groups on older policies keep their own rules", () => {
    const confusion = decisionEngine.decide(
      snap([], { readyParticipantIds: ["p1"] }),
      [assessment("explicit_confusion")],
      ctx(V23, { groupGenerationInProgress: true, lastManualGroupAt: NOW })
    );
    assert.equal(confusion.action, "offer");
    assert.equal(confusion.supportType, "reasoning_prompt");
  });

  test("every new no-action reason has a plain explanation that names nobody", async () => {
    const decisions = [
      decisionEngine.decide(snap([]), [assessment("explicit_confusion")], ctx(UNIFIED)),
      await decide(snap([], { startedAt: isoAt(NOW, -10), readyParticipantIds: ["p1"] })),
      await decide(QUIET(), { groupGenerationInProgress: true }),
      await decide(QUIET(), { lastManualGroupAt: NOW }),
    ];
    assert.deepEqual(
      decisions.map((d) => d.reasonCode),
      ["not_a_proactive_group_reason", "final_answer_in_progress", "group_ai_generating", "recent_manual_group_request"]
    );
    for (const decision of decisions) {
      assert.notEqual(decision.reasonExplanation, decision.reasonCode);
      assert.ok(!/p1|p2/.test(decision.reasonExplanation));
    }
  });
});

describe("Manual group cooldown", () => {
  test("A8: reports whole remaining seconds from server times", () => {
    const at = "2026-01-01T10:00:00.000Z";
    assert.equal(manualCooldownRemaining(at, isoAt(at, 0), 30), 30);
    assert.equal(manualCooldownRemaining(at, isoAt(at, 0.2), 30), 30);
    assert.equal(manualCooldownRemaining(at, isoAt(at, 12), 30), 18);
    assert.equal(manualCooldownRemaining(at, isoAt(at, 29.5), 30), 1);
    assert.equal(manualCooldownRemaining(at, isoAt(at, 30), 30), 0);
    assert.equal(manualCooldownRemaining(at, isoAt(at, 45), 30), 0);
    assert.equal(manualCooldownRemaining(at, isoAt(at, -5), 30), 0, "a clock that moved back does not block");
    assert.equal(manualCooldownRemaining("not a date", at, 30), 0);
  });
});

function view(overrides: Partial<InterventionView>): InterventionView {
  return {
    id: "i1",
    scenarioOrder: 1,
    scope: "group",
    initiatedBy: "participant",
    requestedByName: "Ana",
    trigger: "student_requested",
    supportType: "discussion_summary",
    supportLabel: "Summary of the discussion",
    scaffoldLevel: "process",
    status: "delivered",
    offerText: "Summary of the discussion",
    content: "What has each of you said so far?",
    reasonExplanation: "A group member asked the AI for this collaboration help.",
    aiOrigin: "mock",
    createdAt: isoAt(NOW, 10),
    acceptedAt: isoAt(NOW, 10),
    deliveredAt: isoAt(NOW, 12),
    failureReason: null,
    myFeedback: null,
    deferredUntil: null,
    ...overrides,
  };
}

function human(id: string, secondsAfter: number, text = "hello"): DiscussionMessage {
  return { id, participantId: "p1", authorName: "Ana", colorIndex: 0, text, createdAt: isoAt(NOW, secondsAfter) };
}

describe("Unified group timeline read model", () => {
  test("A5: human messages, group AI replies, offers, excerpts and prompts are ordered by server time with stable keys", () => {
    const events = buildGroupTimeline({
      scenarioOrder: 1,
      messages: [human("m2", 30), human("m1", 0)],
      groupItems: [
        view({ id: "manual", createdAt: isoAt(NOW, 10), acceptedAt: isoAt(NOW, 10) }),
        view({ id: "offer", initiatedBy: "system", status: "suggested", trigger: "stalled_discussion", createdAt: isoAt(NOW, 20), acceptedAt: null, deliveredAt: null, content: null }),
      ],
      sharedIdeas: [
        { id: "s1", scenarioOrder: 1, participantId: "p2", authorName: "Ben", colorIndex: 1, sharedText: "Compare costs first", sourceLabel: "Hint", createdAt: isoAt(NOW, 40) },
      ],
      prompts: [{ id: "c1", scenarioOrder: 1, kind: "summarize", text: "Summarize", raisedByName: "Ben", createdAt: isoAt(NOW, 50) }],
    });
    assert.deepEqual(
      events.map((e) => [e.key, e.kind]),
      [
        ["message:m1", "human_message"],
        ["intervention:manual", "group_ai_message"],
        ["intervention:offer", "group_ai_offer"],
        ["message:m2", "human_message"],
        ["share:s1", "shared_ai_excerpt"],
        ["checkpoint:c1", "discussion_prompt"],
      ]
    );
    assert.ok(events.every((e) => e.visibility === "group" && e.scenarioOrder === 1));
  });

  test("an accepted proactive offer becomes a group AI message at the time someone said yes", () => {
    const accepted = view({
      id: "offer",
      initiatedBy: "system",
      status: "accepted",
      createdAt: isoAt(NOW, 5),
      acceptedAt: isoAt(NOW, 60),
      content: null,
    });
    assert.equal(groupAiKind(accepted), "group_ai_message");
    const events = buildGroupTimeline({ scenarioOrder: 1, messages: [human("m1", 30)], groupItems: [accepted], sharedIdeas: [] });
    assert.deepEqual(events.map((e) => e.key), ["message:m1", "intervention:offer"]);
    assert.equal(events[1].createdAt, isoAt(NOW, 5));
    for (const status of ["expired", "dismissed", "deferred", "suggested"] as const) {
      assert.equal(groupAiKind(view({ initiatedBy: "system", status })), "group_ai_offer", status);
    }
    assert.equal(groupAiKind(view({ initiatedBy: "participant", status: "failed" })), "group_ai_message");
  });

  test("D29: private items and other scenarios never enter the group timeline; duplicates collapse", () => {
    const events = buildGroupTimeline({
      scenarioOrder: 1,
      messages: [human("m1", 0), human("m1", 0)],
      groupItems: [
        view({ id: "private", scope: "individual", content: "SECRET" }),
        view({ id: "other-scenario", scenarioOrder: 2 }),
        view({ id: "g1" }),
        view({ id: "g1" }),
      ],
      sharedIdeas: [
        { id: "s2", scenarioOrder: 2, participantId: "p2", authorName: "Ben", colorIndex: 1, sharedText: "x", sourceLabel: "Hint", createdAt: NOW },
      ],
    });
    assert.deepEqual(events.map((e) => e.key), ["message:m1", "intervention:g1"]);
    assert.ok(!JSON.stringify(events).includes("SECRET"));
  });
});

describe("Participant page structure", () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  test("A1/A2: exactly three numbered steps; the five group AI buttons live in the Step 1 chat; no facilitator panel", () => {
    const page = read("src/components/ScenarioView.tsx");
    assert.equal(page.match(/<Step number=\{\d\}/g)?.length, 3);
    assert.ok(!/GroupAIFacilitatorPanel|GroupSuggestionIndicator|Shared group facilitator/i.test(page));
    assert.ok(!existsSync(path.join(root, "src/components/GroupAIFacilitatorPanel.tsx")));
    const chat = read("src/components/DiscussionChat.tsx");
    assert.match(chat, /AI Collaboration Assistant/);
    assert.match(chat, /Yes, show a collaboration question/);
    assert.match(chat, /Why this suggestion\?/);
    assert.match(chat, /You can ask the group AI again in/);
    assert.match(chat, /AI-assisted excerpt/);
    const popup = read("src/components/PrivateSuggestionPopup.tsx");
    assert.match(popup, /Private AI suggestion — only you can see this/);
  });
});
