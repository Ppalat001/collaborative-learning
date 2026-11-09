import "../helpers/testDb";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST as interventionsRoute } from "@/app/api/sessions/[code]/interventions/route";
import { GET as timelineGet } from "@/app/api/sessions/[code]/timeline/route";
import type { FacilitatorRequest, GeneratedSupport } from "@/lib/ai/GroupAIFacilitator";
import { errorResponse } from "@/lib/auth/routeAuth";
import { PersonalInterventionCoach } from "@/lib/ai/PersonalInterventionCoach";
import { db, schema } from "@/lib/db";
import type { GroupTimelineEvent } from "@/lib/groupTimeline";
import { InterventionOrchestrator, setOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { resetExposureRateLimits } from "@/lib/intervention/OfferExposureService";
import { resetPresence } from "@/lib/intervention/presence";
import { EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import { captureEmits } from "@/lib/realtime/emit";
import { shareIdeaWithGroup } from "@/lib/services/interventions";
import {
  getOrCreateAttempt,
  saveIndividualScaffold,
  setParticipantReady,
  updateAttemptFields,
} from "@/lib/services/sessions";
import { withdrawParticipantConsent } from "@/lib/services/studyV2";
import { buildGroupExport } from "@/lib/utils/export";
import { buildV2Dashboard, buildV2Export } from "@/lib/utils/exportV2";
import {
  apiRequest,
  attemptFor,
  CountingFacilitator,
  createLegacyGroup,
  createV2Group,
  feedbackRows,
  interventionRows,
  routeParams,
  say,
  setOnline,
  TestClock,
  type TestGroup,
} from "../helpers/fixtures";

const UNIFIED_TEST = "policy-unified-1-test-accelerated";

/** Generation waits until the test opens the gate, so "while generating" can be observed. */
class GatedFacilitator extends CountingFacilitator {
  private release: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  hold() {
    this.gate = new Promise((resolve) => (this.release = resolve));
  }
  open() {
    this.release?.();
    this.gate = null;
  }
  override async generateProcessSupport(request: FacilitatorRequest): Promise<GeneratedSupport> {
    if (this.gate) await this.gate;
    return super.generateProcessSupport(request);
  }
}

class FailingFacilitator extends CountingFacilitator {
  override async generateProcessSupport(): Promise<GeneratedSupport> {
    this.calls++;
    throw new Error("provider down");
  }
}

/** Route handlers and the test share one orchestrator and one fake clock. */
function setup(facilitator: CountingFacilitator = new CountingFacilitator(), clock = new TestClock()) {
  const coach = new PersonalInterventionCoach(
    async () => {
      throw new Error("no real provider in tests");
    },
    () => false
  );
  const orchestrator = new InterventionOrchestrator({ clock: clock.now, facilitator, coach });
  setOrchestrator(orchestrator);
  return { clock, orchestrator, facilitator };
}

async function unifiedGroup(members = 2, policyVersion = UNIFIED_TEST, condition: "proactive_adaptive" | "proactive_group" = "proactive_adaptive") {
  const group = await createV2Group({ condition, members, policyVersion });
  await getOrCreateAttempt(group.session.id, 1);
  return group;
}

function groupRequest(group: TestGroup, index: number, supportType: string, requestId: string = crypto.randomUUID()) {
  const member = group.members[index];
  return interventionsRoute(
    apiRequest(`/api/sessions/${group.session.code}/interventions`, {
      method: "POST",
      token: member.token,
      body: { participantId: member.participant.id, scenarioOrder: 1, kind: "group_request", supportType, requestId },
    }),
    routeParams({ code: group.session.code })
  );
}

function timelineRequest(
  group: TestGroup,
  index: number,
  options: { code?: string; token?: string | null; participantId?: string } = {}
) {
  const member = group.members[index];
  const code = options.code ?? group.session.code;
  const query = new URLSearchParams({
    participantId: options.participantId ?? member.participant.id,
    scenarioOrder: "1",
  });
  return timelineGet(
    apiRequest(`/api/sessions/${code}/timeline?${query}`, {
      token: options.token === undefined ? member.token : options.token,
    }),
    routeParams({ code })
  );
}

async function timeline(group: TestGroup, index: number): Promise<GroupTimelineEvent[]> {
  const res = await timelineRequest(group, index);
  assert.equal(res.status, 200);
  return (await res.json()).events;
}

function respond(group: TestGroup, index: number, interventionId: string, action: "accepted" | "dismissed" | "deferred") {
  return {
    session: group.session,
    assignment: group.assignment,
    participant: group.members[index].participant,
    interventionId,
    action,
  };
}

const kinds = (events: GroupTimelineEvent[]) => events.map((e) => e.kind);
const humanMessageRows = (sessionId: string) =>
  db.select().from(schema.discussionMessages).where(eq(schema.discussionMessages.sessionId, sessionId)).all();

beforeEach(() => {
  resetPresence();
  resetExposureRateLimits();
});

describe("Step 1: one group chat (timeline read model)", () => {
  test("A3/A4/A5: human messages, a group AI reply and a shared excerpt appear in order for every member; AI is never a human row", async () => {
    const group = await unifiedGroup();
    // Shared excerpts are stamped with the real time, so the fake clock starts in the past.
    const { clock, facilitator } = setup(new CountingFacilitator(), new TestClock(new Date(Date.now() - 3_600_000)));
    const [a, b] = group.members.map((m) => m.participant);
    await say(group, 0, "I think we should start with the costs", clock.advance(1));
    const emits = captureEmits();

    clock.advance(1);
    const res = await groupRequest(group, 0, "discussion_summary");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.intervention.status, "delivered");
    assert.equal(body.retryAfterSeconds, 1, "the accelerated policy's per-member wait, from the server");
    assert.equal(facilitator.calls, 1);
    const room = `${group.session.code}:1`;
    assert.ok(emits.some((e) => e.target === room && e.event === "intervention:delivered"), "broadcast to the group room");

    await say(group, 1, "Good summary, I agree with the cost point", clock.advance(1));
    await saveIndividualScaffold({
      sessionId: group.session.id,
      participantId: b.id,
      scenarioOrder: 1,
      scaffoldingType: "hint",
      aiResponse: "PRIVATE ORIGINAL: think about who pays for the extra staff and whether the budget allows it.",
      aiModel: "mock",
    });
    clock.advance(1);
    await shareIdeaWithGroup({
      assignment: group.assignment,
      session: group.session,
      participantId: b.id,
      scenarioOrder: 1,
      sourceType: "individual_scaffold",
      sourceId: "hint",
      sharedText: "Who pays for the extra staff?",
    });

    const forA = await timeline(group, 0);
    const forB = await timeline(group, 1);
    assert.deepEqual(kinds(forA), ["human_message", "group_ai_message", "human_message", "shared_ai_excerpt"]);
    assert.deepEqual(forA.map((e) => e.key), forB.map((e) => e.key), "every member sees the same chat");
    const reply = forB[1];
    assert.equal(reply.kind, "group_ai_message");
    if (reply.kind === "group_ai_message") {
      assert.equal(reply.item.initiatedBy, "participant");
      assert.equal(reply.item.requestedByName, a.displayName);
      assert.ok(reply.item.content);
    }
    const excerpt = forA[3];
    assert.ok(excerpt.kind === "shared_ai_excerpt" && excerpt.excerpt.sharedText === "Who pays for the extra staff?");
    assert.ok(!JSON.stringify(forA).includes("PRIVATE ORIGINAL"), "D31: only the approved excerpt is visible");

    const humans = humanMessageRows(group.session.id);
    assert.equal(humans.length, 2, "A4: group AI replies are not stored as chat messages");
    const exported = await buildGroupExport("messages", group.session.id);
    assert.equal(exported.rows.length, 2, "D34: the chat export stays human-only");
    assert.ok(!JSON.stringify(exported.rows).includes(body.intervention.content));
  });

  test("A7: group AI items stored before this change (older policy) appear in the same chat", async () => {
    const group = await unifiedGroup(2, "policy-v2-3-test-accelerated");
    const { clock } = setup();
    await say(group, 0, "Hello", clock.advance(1));
    clock.advance(1);
    assert.equal((await groupRequest(group, 1, "reflection_checkpoint")).status, 200);
    const events = await timeline(group, 0);
    assert.deepEqual(kinds(events), ["human_message", "group_ai_message"]);
    const reply = events[1];
    assert.ok(reply.kind === "group_ai_message" && reply.item.status === "delivered" && reply.item.aiOrigin === "mock");
  });

  test("A8: the cooldown names the remaining seconds, is per member and nothing is stored or generated for a rejected click", async () => {
    const group = await unifiedGroup(2, "policy-unified-1");
    const { clock, facilitator } = setup();
    assert.equal((await groupRequest(group, 0, "discussion_summary")).status, 200);
    clock.advance(12);
    const rejected = await groupRequest(group, 0, "reasoning_prompt");
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("Retry-After"), "18");
    const body = await rejected.json();
    assert.equal(body.code, "too_fast");
    assert.equal(body.retryAfterSeconds, 18);
    assert.equal(body.error, "You can ask the group AI again in 18 seconds");
    assert.equal(facilitator.calls, 1);
    assert.equal(interventionRows(group.session.id).length, 1);

    assert.equal((await groupRequest(group, 1, "reasoning_prompt")).status, 200, "another member is not blocked");
    clock.advance(18);
    assert.equal((await groupRequest(group, 0, "reasoning_prompt")).status, 200);
  });

  test("the wait time survives an error thrown by another copy of the module (custom server + bundled routes)", async () => {
    const foreign = Object.assign(new Error("You can ask the group AI again in 7 seconds"), {
      name: "EligibilityError",
      code: "too_fast",
      status: 429,
      blockers: [],
      retryAfterSeconds: 7,
    });
    assert.ok(!(foreign instanceof EligibilityError));
    const response = errorResponse(foreign);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "7");
    assert.deepEqual(await response.json(), {
      error: "You can ask the group AI again in 7 seconds",
      code: "too_fast",
      blockers: [],
      retryAfterSeconds: 7,
    });
  });

  test("the group limit of six requests per scenario is explained; rejected requests are not counted", async () => {
    const group = await unifiedGroup(2, "policy-unified-1");
    const { clock, facilitator } = setup();
    const types = ["discussion_summary", "cognitive_division", "disagreement_mediation", "reasoning_prompt", "reflection_checkpoint"];
    for (let i = 0; i < 6; i++) {
      clock.advance(31);
      assert.equal((await groupRequest(group, i % 2, types[i % types.length])).status, 200, `request ${i + 1}`);
    }
    clock.advance(31);
    const limit = await groupRequest(group, 0, "reasoning_prompt");
    assert.equal(limit.status, 429);
    const body = await limit.json();
    assert.equal(body.code, "request_limit");
    assert.equal(body.error, "Your group has used all 6 group AI requests for this scenario");
    assert.equal(facilitator.calls, 6);
    assert.equal(interventionRows(group.session.id).length, 6);
  });

  test("A9: a retried click and two members asking for the same help at once give one reply", async () => {
    const group = await unifiedGroup();
    const { clock, facilitator } = setup();
    const first = await groupRequest(group, 0, "cognitive_division", "click-1");
    const retry = await groupRequest(group, 0, "cognitive_division", "click-1");
    assert.equal((await first.json()).duplicate, false);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(facilitator.calls, 1);

    clock.advance(2);
    const [x, y] = await Promise.all([
      groupRequest(group, 0, "disagreement_mediation"),
      groupRequest(group, 1, "disagreement_mediation"),
    ]);
    const bodies = [await x.json(), await y.json()];
    assert.equal(bodies.filter((b) => b.duplicate === false).length, 1);
    assert.equal(bodies[0].intervention.id, bodies[1].intervention.id);
    assert.equal(facilitator.calls, 2);
  });

  test("A6: members keep chatting while the AI writes; a failure is shown and does not block the chat", async () => {
    const group = await unifiedGroup();
    const gated = new GatedFacilitator();
    const { clock } = setup(gated);
    gated.hold();
    const pending = groupRequest(group, 0, "discussion_summary");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await say(group, 1, "While we wait: I think option A", clock.advance(1));
    const during = await timeline(group, 1);
    const generating = during.find((e) => e.kind === "group_ai_message");
    assert.ok(generating?.kind === "group_ai_message" && generating.item.status === "accepted", "a writing placeholder for everyone");
    assert.ok(during.some((e) => e.kind === "human_message"));
    gated.open();
    assert.equal((await pending).status, 200);

    const failing = await unifiedGroup();
    setup(new FailingFacilitator());
    const res = await groupRequest(failing, 0, "reasoning_prompt");
    assert.equal(res.status, 200);
    const view = (await res.json()).intervention;
    assert.equal(view.status, "failed");
    assert.equal(view.failureReason, "The AI is unavailable right now.");
    await say(failing, 1, "No problem, let's continue", new Date());
    assert.deepEqual(kinds(await timeline(failing, 0)), ["group_ai_message", "human_message"]);
  });
});

describe("Proactive group offers in the chat", () => {
  test("B10/B11: a quiet group gets one in-chat offer and the AI is not called until someone says yes", async () => {
    const group = await unifiedGroup();
    const { clock, orchestrator, facilitator } = setup();
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");
    assert.equal(outcome?.decision.action, "offer");
    assert.equal(outcome?.decision.trigger, "initial_silence");
    assert.equal(facilitator.calls, 0);
    const offer = outcome!.intervention!;
    assert.match(offer.offerText, /collaboration question/);

    for (const index of [0, 1]) {
      const [event] = await timeline(group, index);
      assert.equal(event.kind, "group_ai_offer");
    }
    const accepted = await orchestrator.handlePrivateOfferResponse(respond(group, 1, offer.id, "accepted"));
    assert.equal(accepted.status, "delivered");
    assert.equal(facilitator.calls, 1);
    const [event] = await timeline(group, 0);
    assert.ok(event.kind === "group_ai_message" && event.item.initiatedBy === "system" && event.item.content);
  });

  test("B15: hiding is per member, and two members saying yes at once produce one reply", async () => {
    const group = await unifiedGroup(3);
    const { clock, orchestrator, facilitator } = setup();
    setOnline(group, [0, 1, 2], clock.current);
    clock.advance(5);
    const offer = (await orchestrator.evaluateAttempt(group.session.id, 1))!.intervention!;

    const hidden = await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "dismissed"));
    assert.equal(hidden.status, "suggested", "still open for the others");
    assert.equal(hidden.myFeedback, "dismissed");
    const [forB] = await timeline(group, 1);
    assert.ok(forB.kind === "group_ai_offer" && forB.item.myFeedback === null && forB.item.status === "suggested");

    await Promise.all([
      orchestrator.handlePrivateOfferResponse(respond(group, 1, offer.id, "accepted")),
      orchestrator.handlePrivateOfferResponse(respond(group, 2, offer.id, "accepted")),
    ]);
    assert.equal(facilitator.calls, 1);
    const row = interventionRows(group.session.id).find((r) => r.id === offer.id)!;
    assert.equal(row.status, "delivered");
    assert.equal(feedbackRows(offer.id).filter((f) => f.action === "accepted").length, 2);
  });

  test("B14/B16: one offer per scenario even after it expires; expiry is not a rejection; manual help still works", async () => {
    const group = await unifiedGroup();
    const { clock, orchestrator } = setup();
    const [a, b] = group.members.map((m) => m.participant);
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    const offer = (await orchestrator.evaluateAttempt(group.session.id, 1))!.intervention!;

    clock.advance(121);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(interventionRows(group.session.id).find((r) => r.id === offer.id)!.status, "expired");
    const again = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(again?.decision.action, "no_action");
    assert.equal(again?.decision.reasonCode, "max_prompts_reached");
    assert.equal(interventionRows(group.session.id).filter((r) => r.initiatedBy === "system" && r.scope === "group").length, 1);

    assert.equal(feedbackRows(offer.id).length, 0, "nobody is recorded as declining");
    const learned = db
      .select()
      .from(schema.learnerModelEvents)
      .where(eq(schema.learnerModelEvents.sessionId, group.session.id))
      .all()
      .filter((e) => e.eventKey.includes(offer.id));
    assert.deepEqual(learned, [], "no learner update from an unanswered group offer");
    const outcomes = db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(eq(schema.interventionOutcomeEvaluations.interventionId, offer.id))
      .all();
    assert.deepEqual(outcomes, [], "no outcome is scored for an offer that was never opened");
    const expiredExposures = db
      .select()
      .from(schema.offerExposures)
      .where(eq(schema.offerExposures.interventionId, offer.id))
      .all()
      .filter((e) => e.kind.startsWith("expired"));
    assert.deepEqual(expiredExposures.map((e) => e.participantId).sort(), [a.id, b.id].sort());

    const [expired] = await timeline(group, 0);
    assert.ok(expired.kind === "group_ai_offer" && expired.item.status === "expired", "still visible as a closed line");
    assert.equal((await groupRequest(group, 0, "reasoning_prompt")).status, 200);
  });

  test("B17: no offers while the AI is writing, right after a manual request, or while a member confirms the final answer", async () => {
    const group = await unifiedGroup();
    const gated = new GatedFacilitator();
    const { clock, orchestrator } = setup(gated);
    const proactive = () =>
      interventionRows(group.session.id).filter((r) => r.scope === "group" && r.initiatedBy === "system");
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);

    gated.hold();
    const pending = groupRequest(group, 0, "discussion_summary");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const whileWriting = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(whileWriting?.decision.reasonCode, "group_ai_generating");
    gated.open();
    await pending;

    const afterManual = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(afterManual?.decision.action, "no_action");
    assert.ok(["awaiting_outcome", "recent_manual_group_request"].includes(afterManual!.decision.reasonCode));
    assert.equal(proactive().length, 0);

    clock.advance(300);
    const writer = group.members[0].participant.id;
    await updateAttemptFields(group.session.id, 1, { finalAnswer: "Our answer" }, null, [], writer);
    const ready = await setParticipantReady(group.session.id, 1, writer, true);
    assert.ok(ready.ok);
    const finalising = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(finalising?.decision.reasonCode, "final_answer_in_progress");
    assert.equal(proactive().length, 0);
  });

  test("only being stuck or going in circles leads to an offer: confusion and coordination questions do not", async () => {
    const group = await unifiedGroup(2, UNIFIED_TEST, "proactive_group");
    const { clock, orchestrator } = setup();
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I'm confused, I don't understand the question", clock.advance(1));
    await say(group, 1, "How should we divide the work between us?", clock.advance(1));
    clock.advance(1);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(outcome?.decision.action, "no_action");
    assert.equal(interventionRows(group.session.id).length, 0);
  });
});

describe("Privacy and access to the group chat", () => {
  async function rejectsWith(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => error instanceof EligibilityError && error.code === code);
  }

  test("D29/D33: private help never appears; wrong token, wrong group, legacy groups and withdrawn members are refused", async () => {
    const group = await unifiedGroup(3);
    const other = await unifiedGroup();
    const { clock } = setup();
    const [a] = group.members.map((m) => m.participant);
    const attempt = attemptFor(group.session.id)!;
    await saveIndividualScaffold({
      sessionId: group.session.id,
      participantId: a.id,
      scenarioOrder: 1,
      scaffoldingType: "explanation",
      aiResponse: "SECRET-STEP2 explanation",
      aiModel: "mock",
    });
    db.insert(schema.interventions)
      .values({
        sessionId: group.session.id,
        attemptId: attempt.id,
        scenarioOrder: 1,
        scope: "individual",
        recipientParticipantId: a.id,
        initiatedBy: "system",
        trigger: "adaptive_need",
        category: "content",
        supportType: "guiding_question",
        scaffoldLevel: "2",
        status: "delivered",
        offerText: "Would you like a guiding question?",
        reasonCode: "adaptive_private",
        reasonExplanation: "Only you can see this.",
        content: "SECRET-POPUP guiding question",
        researchCondition: "proactive_adaptive",
        policyVersion: UNIFIED_TEST,
        promptVersion: "test",
        idempotencyKey: `test-popup-${attempt.id}`,
        aiOrigin: "mock",
        acceptedAt: clock.current.toISOString(),
      })
      .run();
    await say(group, 0, "hello", clock.advance(1));

    for (const index of [0, 1, 2]) {
      const raw = JSON.stringify(await timeline(group, index));
      assert.ok(!raw.includes("SECRET-STEP2") && !raw.includes("SECRET-POPUP"), `member ${index}`);
    }

    assert.equal((await timelineRequest(group, 1, { token: null })).status, 401);
    assert.equal((await timelineRequest(group, 1, { participantId: a.id })).status, 401, "B's device cannot read as A");
    const crossGroup = await timelineRequest(other, 0, { code: group.session.code });
    assert.equal(crossGroup.status, 403);
    const legacy = await createLegacyGroup();
    const legacyRes = await timelineGet(
      apiRequest(`/api/sessions/${legacy.session.code}/timeline?participantId=${legacy.members[0].participant.id}&scenarioOrder=1`),
      routeParams({ code: legacy.session.code })
    );
    assert.equal(legacyRes.status, 404);
    assert.equal((await timelineGet(apiRequest(`/api/sessions/${group.session.code}/timeline?scenarioOrder=0`), routeParams({ code: group.session.code }))).status, 400);

    await withdrawParticipantConsent(group.assignment, group.members[2].participant.id, null);
    assert.equal((await timelineRequest(group, 2)).status, 403);
  });

  test("C19/D30: a full expert answer cannot be quick-shared; an empty or over-long excerpt is refused", async () => {
    const group = await unifiedGroup();
    setup();
    const a = group.members[0].participant;
    const share = (sourceId: string, sharedText: string) =>
      shareIdeaWithGroup({
        assignment: group.assignment,
        session: group.session,
        participantId: a.id,
        scenarioOrder: 1,
        sourceType: "individual_scaffold",
        sourceId,
        sharedText,
      });
    await rejectsWith(share("full_answer", "The answer is B"), "full_answer_not_shareable");
    await saveIndividualScaffold({
      sessionId: group.session.id,
      participantId: a.id,
      scenarioOrder: 1,
      scaffoldingType: "hint",
      aiResponse: "A hint",
      aiModel: "mock",
    });
    await rejectsWith(share("hint", "   "), "empty");
    await rejectsWith(share("hint", "x".repeat(601)), "too_long");
    assert.deepEqual(kinds(await timeline(group, 1)), []);
  });
});

describe("Researcher counts", () => {
  test("E39: AI use is counted separately from human messages, with origins, tokens and failures", async () => {
    const group = await unifiedGroup();
    const { clock, orchestrator } = setup();
    const b = group.members[1].participant;
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    const offer = (await orchestrator.evaluateAttempt(group.session.id, 1))!.intervention!;
    await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "accepted"));
    await say(group, 0, "first", clock.advance(1));
    await say(group, 1, "second", clock.advance(1));
    assert.equal((await groupRequest(group, 0, "discussion_summary")).status, 200);
    await saveIndividualScaffold({
      sessionId: group.session.id,
      participantId: b.id,
      scenarioOrder: 1,
      scaffoldingType: "hint",
      aiResponse: "Think about the cost",
      aiModel: "mock",
    });
    await shareIdeaWithGroup({
      assignment: group.assignment,
      session: group.session,
      participantId: b.id,
      scenarioOrder: 1,
      sourceType: "individual_scaffold",
      sourceId: "hint",
      sharedText: "Think about the cost",
    });

    const usage = buildV2Dashboard(group.session.id)!.aiUsage;
    const popups = interventionRows(group.session.id).filter((r) => r.scope === "individual");
    assert.equal(usage.humanMessages, 2);
    assert.equal(usage.groupAi.manualRequests, 1);
    assert.equal(usage.groupAi.manualReplies, 1);
    assert.equal(usage.groupAi.proactiveOffers, 1);
    assert.equal(usage.groupAi.proactiveAccepted, 1);
    assert.equal(usage.groupAi.proactiveReplies, 1);
    assert.equal(usage.privateAi.manualCalls, 1);
    assert.equal(usage.privateAi.popupsOffered, popups.length, "the private learner may already have offered a popup");
    assert.equal(usage.privateAi.popupsAccepted, 0);
    assert.equal(usage.sharedExcerpts, 1);
    assert.deepEqual(usage.origins.groupAndPopups, { mock: 2 });
    assert.deepEqual(usage.origins.step2, { mock: 1 });
    assert.deepEqual(usage.tokens, { input: 0, output: 0 });
    assert.equal(usage.failures, 0);

    const csv = buildV2Export("v2_ai_usage", [group.session.id]).rows;
    const row = csv.find((r) => r.scenario_number === 1)!;
    assert.equal(row.human_chat_messages, 2);
    assert.equal(row.group_ai_requests, 1);
    assert.equal(row.group_ai_request_replies, 1);
    assert.equal(row.group_ai_proactive_offers, 1);
    assert.equal(row.group_ai_proactive_accepted, 1);
    assert.equal(row.step2_private_ai_replies, 1);
    assert.equal(row.step2_demo_text, 1);
    assert.equal(row.step2_real_ai, 0);
    assert.equal(row.private_popups_offered, popups.length);
    assert.equal(row.shared_excerpts, 1);
    assert.equal(row.ai_replies_demo_text, 2);
    assert.equal(row.failed_generations, 0);
    assert.match(String(row.group_warnings), /demo text/);
    assert.ok(csv.every((r) => r.scenario_number === 1 || r.human_chat_messages === 0));
  });
});
