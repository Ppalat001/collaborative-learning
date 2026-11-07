import "../helpers/testDb";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST as collaborationRoute } from "@/app/api/sessions/[code]/collaboration/route";
import { GET as interventionsGet } from "@/app/api/sessions/[code]/interventions/route";
import { db, schema } from "@/lib/db";
import { discussionCoordinator } from "@/lib/intervention/GroupDiscussionCoordinator";
import { resetPresence } from "@/lib/intervention/presence";
import { EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import { captureEmits } from "@/lib/realtime/emit";
import {
  checkV2PrivateSupportGate,
  listSharedIdeas,
  listVisibleInterventions,
  setPrivateOptIn,
  shareIdeaWithGroup,
} from "@/lib/services/interventions";
import {
  getOrCreateAttempt,
  saveIndividualScaffold,
  setParticipantReady,
  updateAttemptFields,
} from "@/lib/services/sessions";
import {
  apiRequest,
  attemptFor,
  createLegacyGroup,
  createV2Group,
  evaluationRows,
  feedbackRows,
  interventionRows,
  makeOrchestrator,
  routeParams,
  say,
  setOnline,
  TestClock,
  type TestGroup,
} from "../helpers/fixtures";

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof EligibilityError, `expected EligibilityError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

function memberInput(group: TestGroup, index: number) {
  return {
    session: group.session,
    assignment: group.assignment,
    participant: group.members[index].participant,
    scenarioOrder: 1,
  };
}

/** Two members connected; returns the proactive group offer created by initial silence. */
async function initialSilenceOffer(group: TestGroup, clock: TestClock, orchestrator: ReturnType<typeof makeOrchestrator>["orchestrator"]) {
  await getOrCreateAttempt(group.session.id, 1);
  setOnline(group, [0, 1], clock.current);
  clock.advance(5);
  const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");
  assert.equal(outcome?.decision.action, "offer");
  assert.ok(outcome?.intervention);
  return outcome.intervention;
}

beforeEach(() => resetPresence());

describe("Research conditions", () => {
  test("baseline: decisions are logged in shadow mode and nothing is shown or generated", async () => {
    const group = await createV2Group({ condition: "baseline_private_request" });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(10);

    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");
    assert.equal(outcome?.decision.action, "no_action");
    assert.equal(outcome?.decision.reasonCode, "condition_no_proactive");
    assert.equal(outcome?.decision.trigger, "initial_silence");
    const [evaluation] = evaluationRows(group.session.id);
    assert.equal(evaluation.shadowOnly, true);
    assert.equal(evaluation.supportType, "participation_invitation");
    assert.equal(interventionRows(group.session.id).length, 0);
    assert.equal(emits.filter((e) => e.event.startsWith("intervention:")).length, 0);
    assert.equal(facilitator.calls, 0);

    const a = group.members[0].participant;
    await rejectsWith(
      orchestrator.handleManualGroupRequest({ ...memberInput(group, 0), supportType: "discussion_summary" }),
      "not_in_condition"
    );
    await rejectsWith(orchestrator.handlePersonalRequest(memberInput(group, 0)), "not_in_condition");
    await rejectsWith(setPrivateOptIn(group.assignment, a.id, true), "not_in_condition");
    await rejectsWith(
      shareIdeaWithGroup({
        assignment: group.assignment,
        session: group.session,
        participantId: a.id,
        scenarioOrder: 1,
        sourceType: "individual_scaffold",
        sourceId: "hint",
        sharedText: "idea",
      }),
      "not_in_condition"
    );
  });

  test("shared_on_demand: no unsolicited offers; a manual request is shared with the whole group once", async () => {
    const group = await createV2Group({ condition: "shared_on_demand" });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(10);

    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(outcome?.decision.reasonCode, "condition_no_proactive");
    assert.equal(interventionRows(group.session.id).length, 0);

    const request = { ...memberInput(group, 0), supportType: "discussion_summary", requestId: "req-1" };
    const first = await orchestrator.handleManualGroupRequest(request);
    assert.equal(first.duplicate, false);
    assert.equal(first.view.status, "delivered");
    assert.equal(first.view.aiOrigin, "mock");
    assert.ok(first.view.content);
    const repeat = await orchestrator.handleManualGroupRequest(request);
    assert.equal(repeat.duplicate, true);
    assert.equal(facilitator.calls, 1);
    assert.equal(interventionRows(group.session.id).length, 1);

    const attempt = attemptFor(group.session.id)!;
    const seenByB = listVisibleInterventions(attempt.id, group.members[1].participant.id, group.session.id, 0);
    assert.equal(seenByB.find((i) => i.id === first.view.id)?.content, first.view.content);
    const room = `${group.session.code}:1`;
    assert.ok(emits.some((e) => e.target === room && e.event === "intervention:delivered"));
    assert.ok(!emits.some((e) => e.target.startsWith("participant:")));

    await rejectsWith(
      orchestrator.handleManualGroupRequest({ ...memberInput(group, 0), supportType: "full_answer" }),
      "invalid_support_type"
    );
    await rejectsWith(
      orchestrator.handleManualGroupRequest({ ...memberInput(group, 0), supportType: "reasoning_prompt", requestId: "req-2" }),
      "too_fast"
    );
  });

  test("proactive_group: initial silence needs two connected members; content is generated only on accept, once", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);

    setOnline(group, [0], clock.current);
    clock.advance(10);
    assert.equal((await orchestrator.evaluateAttempt(group.session.id, 1))?.decision.action, "no_action");
    setOnline(group, [1], clock.current);
    assert.equal((await orchestrator.evaluateAttempt(group.session.id, 1))?.decision.action, "no_action");
    assert.equal(interventionRows(group.session.id).length, 0);

    clock.advance(5);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(outcome?.decision.action, "offer");
    assert.equal(outcome?.decision.scope, "group");
    assert.equal(outcome?.decision.trigger, "initial_silence");
    const offer = outcome!.intervention!;
    assert.equal(offer.status, "suggested");
    assert.equal(offer.content, null);
    assert.equal(offer.recipientParticipantId, null);
    assert.equal(facilitator.calls, 0);
    assert.ok(emits.some((e) => e.target === `${group.session.code}:1` && e.event === "intervention:offered"));

    const pending = await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(pending?.decision.reasonCode, "offer_pending");
    assert.equal(interventionRows(group.session.id).length, 1);

    const accepted = await orchestrator.handlePrivateOfferResponse({
      ...memberInput(group, 0),
      interventionId: offer.id,
      action: "accepted",
    });
    assert.equal(accepted.status, "delivered");
    assert.ok(accepted.content);
    const second = await orchestrator.handlePrivateOfferResponse({
      ...memberInput(group, 1),
      interventionId: offer.id,
      action: "accepted",
    });
    assert.equal(second.status, "delivered");
    assert.equal(facilitator.calls, 1);
    assert.deepEqual(
      feedbackRows(offer.id).map((f) => f.action),
      ["accepted", "accepted"]
    );
  });

  test("proactive_group: the first dismissal closes the offer for everyone; 'Not now' is personal", async () => {
    const group = await createV2Group({ condition: "proactive_group", members: 3 });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    const offer = await initialSilenceOffer(group, clock, orchestrator);

    const deferred = await orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 2), interventionId: offer.id, action: "deferred" });
    assert.equal(deferred.status, "suggested");
    assert.ok(deferred.deferredUntil);
    const dismissed = await orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 1), interventionId: offer.id, action: "dismissed" });
    assert.equal(dismissed.status, "dismissed");
    const late = await orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 0), interventionId: offer.id, action: "accepted" });
    assert.equal(late.status, "dismissed");
    assert.equal(facilitator.calls, 0);
  });

  test("proactive_group never makes private offers, even for one member's own confusion", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I'm confused, I don't get this question", clock.current);
    await rejectsWith(setPrivateOptIn(group.assignment, group.members[0].participant.id, true), "not_in_condition");
    clock.advance(1);

    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "human_activity");
    assert.equal(outcome?.decision.action, "offer");
    assert.equal(outcome?.decision.scope, "group");
    assert.equal(outcome?.decision.trigger, "explicit_confusion");
    assert.equal(outcome?.decision.targetParticipantId, undefined);
    assert.ok(interventionRows(group.session.id).every((row) => row.scope === "group" && !row.recipientParticipantId));
    assert.ok(evaluationRows(group.session.id).every((row) => !row.targetParticipantId));
  });

  test("dual_adaptive: private offers only for opted-in members and only visible to them", async () => {
    const group = await createV2Group({ condition: "dual_adaptive" });
    const [a, b] = group.members;
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);
    await setPrivateOptIn(group.assignment, a.participant.id, true);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I'm lost, I don't understand this part", clock.current);
    clock.advance(1);

    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "human_activity");
    assert.equal(outcome?.decision.scope, "individual");
    assert.equal(outcome?.decision.targetParticipantId, a.participant.id);
    const offer = outcome!.intervention!;
    assert.equal(offer.recipientParticipantId, a.participant.id);
    assert.equal(offer.content, null);
    const offerEmits = emits.filter((e) => (e.payload as { id?: string }).id === offer.id);
    assert.deepEqual([...new Set(offerEmits.map((e) => e.target))], [`participant:${a.participant.id}`]);

    const attempt = attemptFor(group.session.id)!;
    assert.ok(!listVisibleInterventions(attempt.id, b.participant.id, group.session.id, 0).some((i) => i.id === offer.id));
    assert.ok(listVisibleInterventions(attempt.id, a.participant.id, group.session.id, 0).some((i) => i.id === offer.id));

    const code = group.session.code;
    const asB = await interventionsGet(
      apiRequest(`/api/sessions/${code}/interventions?participantId=${b.participant.id}&scenarioOrder=1`, { token: b.token }),
      routeParams({ code })
    );
    assert.equal(asB.status, 200);
    assert.ok(!(await asB.json()).interventions.some((i: { id: string }) => i.id === offer.id));
    const impersonation = await interventionsGet(
      apiRequest(`/api/sessions/${code}/interventions?participantId=${a.participant.id}&scenarioOrder=1`, { token: b.token }),
      routeParams({ code })
    );
    assert.equal(impersonation.status, 401);
    await rejectsWith(
      orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 1), interventionId: offer.id, action: "accepted" }),
      "not_found"
    );

    const delivered = await orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 0), interventionId: offer.id, action: "accepted" });
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.aiOrigin, "mock");
    const recommendation = db
      .select()
      .from(schema.scaffoldRecommendations)
      .where(eq(schema.scaffoldRecommendations.interventionId, offer.id))
      .get();
    assert.equal(recommendation?.recommendedLevel, 1);

    await say(group, 1, "I am stuck too, I don't get it", clock.current);
    clock.advance(1);
    const forB = await orchestrator.evaluateAttempt(group.session.id, 1, "human_activity");
    assert.equal(forB?.decision.action, "offer");
    assert.equal(forB?.decision.scope, "group");
  });

  test("'I'm stuck' creates a private offer at the least intrusive level; nothing is generated before accepting", async () => {
    const group = await createV2Group({ condition: "dual_adaptive" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    const first = await orchestrator.handlePersonalRequest({ ...memberInput(group, 0), requestId: "stuck-1" });
    assert.equal(first.view.scope, "individual");
    assert.equal(first.view.status, "suggested");
    assert.equal(first.view.content, null);
    assert.equal(first.view.scaffoldLevel, "1");
    const again = await orchestrator.handlePersonalRequest({ ...memberInput(group, 0), requestId: "stuck-2" });
    assert.equal(again.duplicate, true);
    assert.equal(again.view.id, first.view.id);
  });
});

describe("Logging and safety", () => {
  test("repeated identical no-action evaluations collapse into one row", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    for (let i = 0; i < 3; i++) {
      clock.advance(1);
      await orchestrator.evaluateAttempt(group.session.id, 1);
    }
    let rows = evaluationRows(group.session.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].repeatCount, 3);
    assert.equal(rows[0].decisionAction, "no_action");

    await say(group, 0, "Let's start with the costs", clock.current);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    rows = evaluationRows(group.session.id);
    assert.equal(rows.length, 2);
  });

  test("concurrent evaluations create at most one offer", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    await Promise.all([
      orchestrator.evaluateAttempt(group.session.id, 1),
      orchestrator.evaluateAttempt(group.session.id, 1),
      orchestrator.evaluateAttempt(group.session.id, 1),
    ]);
    await orchestrator.idle();
    assert.equal(interventionRows(group.session.id).length, 1);
  });

  test("a burst of activity is debounced into one evaluation", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    const event = {
      sessionId: group.session.id,
      sessionCode: group.session.code,
      scenarioOrder: 1,
      participantId: group.members[0].participant.id,
      kind: "message" as const,
    };
    orchestrator.onHumanActivity(event);
    orchestrator.onHumanActivity(event);
    orchestrator.onHumanActivity(event);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await orchestrator.idle();
    const rows = evaluationRows(group.session.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].evaluationSource, "human_activity");
    orchestrator.stop();
  });

  test("after submission open offers expire and nothing new is generated", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    const offer = await initialSilenceOffer(group, clock, orchestrator);
    const [a, b] = group.members;

    await updateAttemptFields(group.session.id, 1, { finalAnswer: "Our answer" }, null, [], a.participant.id);
    await setParticipantReady(group.session.id, 1, a.participant.id, true);
    const done = await setParticipantReady(group.session.id, 1, b.participant.id, true);
    assert.ok(done.ok && done.value.submitted);
    await orchestrator.onScenarioSubmitted({ sessionId: group.session.id, sessionCode: group.session.code, scenarioOrder: 1 });

    const row = interventionRows(group.session.id).find((r) => r.id === offer.id);
    assert.equal(row?.status, "expired");
    await rejectsWith(
      orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 0), interventionId: offer.id, action: "accepted" }),
      "scenario_submitted"
    );
    assert.equal(await orchestrator.evaluateAttempt(group.session.id, 1), null);
    await rejectsWith(
      orchestrator.handleManualGroupRequest({ ...memberInput(group, 0), supportType: "discussion_summary", requestId: "late" }),
      "scenario_submitted"
    );
    assert.equal(facilitator.calls, 0);
  });

  test("without an API key, AI support is template text and is recorded as mock", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator, facilitator } = makeOrchestrator(clock);
    assert.equal(await checkV2PrivateSupportGate(group.assignment, group.members[0].participant.id, 1), null);

    const offer = await initialSilenceOffer(group, clock, orchestrator);
    const view = await orchestrator.handlePrivateOfferResponse({ ...memberInput(group, 0), interventionId: offer.id, action: "accepted" });
    assert.equal(view.status, "delivered");
    assert.ok(view.content);
    const row = interventionRows(group.session.id).find((r) => r.id === offer.id)!;
    assert.equal(row.aiOrigin, "mock");
    assert.equal(row.aiModel, "mock");
    assert.equal(facilitator.calls, 1);
  });

  test("a required initial idea comes before any AI support", async () => {
    const group = await createV2Group({ condition: "shared_on_demand", features: { initialIdea: "required" } });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    const a = group.members[0].participant;
    await getOrCreateAttempt(group.session.id, 1);
    assert.equal((await checkV2PrivateSupportGate(group.assignment, a.id, 1))?.code, "initial_idea_required");
    await rejectsWith(
      orchestrator.handleManualGroupRequest({ ...memberInput(group, 0), supportType: "discussion_summary" }),
      "initial_idea_required"
    );
    await discussionCoordinator.recordInitialIdea({ sessionId: group.session.id, participantId: a.id, scenarioOrder: 1, text: "My idea" });
    assert.equal(await checkV2PrivateSupportGate(group.assignment, a.id, 1), null);
    await rejectsWith(
      discussionCoordinator.recordInitialIdea({ sessionId: group.session.id, participantId: a.id, scenarioOrder: 1, text: "Changed" }),
      "already_recorded"
    );
  });
});

describe("Explicit sharing of private AI ideas", () => {
  test("only your own non-answer support can be shared, after confirming", async () => {
    const group = await createV2Group({ condition: "shared_on_demand" });
    const [a, b] = group.members;
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);
    for (const [type, text] of [
      ["hint", "Consider who pays for each option."],
      ["full_answer", "The full model answer."],
    ]) {
      await saveIndividualScaffold({
        sessionId: group.session.id,
        participantId: a.participant.id,
        scenarioOrder: 1,
        scaffoldingType: type,
        aiResponse: text,
      });
    }
    const base = {
      assignment: group.assignment,
      session: group.session,
      scenarioOrder: 1,
      sourceType: "individual_scaffold" as const,
    };

    const shared = await shareIdeaWithGroup({ ...base, participantId: a.participant.id, sourceId: "hint", sharedText: "Consider who pays." });
    assert.equal(shared.sharedText, "Consider who pays.");
    assert.ok(emits.some((e) => e.target === `${group.session.code}:1` && e.event === "ideas:shared"));
    await rejectsWith(
      shareIdeaWithGroup({ ...base, participantId: a.participant.id, sourceId: "full_answer", sharedText: "x" }),
      "full_answer_not_shareable"
    );
    await rejectsWith(
      shareIdeaWithGroup({ ...base, participantId: b.participant.id, sourceId: "hint", sharedText: "x" }),
      "not_found"
    );
    await rejectsWith(
      shareIdeaWithGroup({ ...base, participantId: a.participant.id, sourceId: "hint", sharedText: "x".repeat(700) }),
      "too_long"
    );
    assert.equal(listSharedIdeas(group.session.id, 1).length, 1);

    const code = group.session.code;
    const unconfirmed = await collaborationRoute(
      apiRequest(`/api/sessions/${code}/collaboration`, {
        method: "POST",
        token: a.token,
        body: { participantId: a.participant.id, scenarioOrder: 1, action: "share", sourceType: "individual_scaffold", sourceId: "hint", sharedText: "again" },
      }),
      routeParams({ code })
    );
    assert.equal(unconfirmed.status, 400);
    assert.equal(listSharedIdeas(group.session.id, 1).length, 1);
  });

  test("V2-only endpoints are not available to legacy groups", async () => {
    const legacy = await createLegacyGroup(2);
    const member = legacy.members[0].participant;
    const code = legacy.session.code;
    const response = await interventionsGet(
      apiRequest(`/api/sessions/${code}/interventions?participantId=${member.id}&scenarioOrder=1`),
      routeParams({ code })
    );
    assert.equal(response.status, 404);
  });
});
