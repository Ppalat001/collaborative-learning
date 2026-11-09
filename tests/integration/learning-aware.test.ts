import { TEST_DATABASE_FILE } from "../helpers/testDb";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { GET as rubricGet, POST as rubricPost } from "@/app/api/admin/v2-3/open-rubric/route";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/admin/v2-3/review/route";
import { POST as exposureRoute } from "@/app/api/sessions/[code]/interventions/[id]/exposure/route";
import { POST as progressRoute } from "@/app/api/sessions/[code]/interventions/[id]/progress/route";
import { POST as interventionsRoute } from "@/app/api/sessions/[code]/interventions/route";
import { PersonalInterventionCoach } from "@/lib/ai/PersonalInterventionCoach";
import { db, schema } from "@/lib/db";
import type { LearnerState } from "@/lib/intervention/adaptive/LearnerModel";
import { learnerStore } from "@/lib/intervention/adaptive/LearnerModelStore";
import { InterventionOrchestrator, setOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { learningAwareMemberState } from "@/lib/intervention/learning/LearnerEvidenceAggregator";
import { resetExposureRateLimits } from "@/lib/intervention/OfferExposureService";
import { getPolicy } from "@/lib/intervention/policies";
import { resetPresence } from "@/lib/intervention/presence";
import { captureEmits } from "@/lib/realtime/emit";
import { listVisibleInterventions } from "@/lib/services/interventions";
import { getOrCreateAttempt, setParticipantReady, updateAttemptFields } from "@/lib/services/sessions";
import { buildV23Dashboard, buildV23Export, V23_EXPORTS, type V23ExportType } from "@/lib/utils/exportV23";
import {
  apiRequest,
  attemptFor,
  CountingFacilitator,
  createLegacyGroup,
  createV2Group,
  interventionRows,
  routeParams,
  say,
  setOnline,
  TestClock,
  type TestGroup,
} from "../helpers/fixtures";

const V23 = "policy-v2-3-test-accelerated";
const ADMIN = { "x-admin-password": "research-admin" };

/** The route handlers use the same orchestrator (and fake clock) as the test. */
function setup(clock = new TestClock()) {
  const coach = new PersonalInterventionCoach(
    async () => {
      throw new Error("no real provider in tests");
    },
    () => false
  );
  const orchestrator = new InterventionOrchestrator({ clock: clock.now, facilitator: new CountingFacilitator(), coach });
  setOrchestrator(orchestrator);
  return { clock, orchestrator };
}

const STRONG = { alpha: 500, beta: 1 };
const WEAK = { alpha: 1, beta: 500 };
const EAGER: Partial<LearnerState> = {
  receptiveness: STRONG,
  independence: WEAK,
  arms: { guiding_question: STRONG, hint: WEAK, explanation: WEAK },
};
const RELUCTANT: Partial<LearnerState> = { receptiveness: WEAK, independence: STRONG };

function primeModel(group: TestGroup, index: number, patch: Partial<LearnerState>, clock: TestClock) {
  const policy = getPolicy(group.assignment.interventionPolicyVersion);
  const row = learnerStore.load({
    sessionId: group.session.id,
    participantId: group.members[index].participant.id,
    policyVersion: policy.version,
    policy: policy.adaptivePrivate!,
    now: clock.current.toISOString(),
  });
  db.update(schema.learnerModels)
    .set({ state: { ...row.state, ...patch } })
    .where(eq(schema.learnerModels.id, row.id))
    .run();
}

const modelOf = (participantId: string) => learnerStore.get(participantId)!.state;
const adaptiveRows = (sessionId: string, scenarioOrder = 1) =>
  interventionRows(sessionId).filter((r) => r.reasonCode === "adaptive_private" && r.scenarioOrder === scenarioOrder);
const groupRows = (sessionId: string) => interventionRows(sessionId).filter((r) => r.scope === "group");
const tracesOf = (participantId: string) =>
  db.select().from(schema.privateDecisionTraces).where(eq(schema.privateDecisionTraces.participantId, participantId)).all();
const scaffoldingOf = (participantId: string) =>
  db.select().from(schema.scaffoldingStateEvents).where(eq(schema.scaffoldingStateEvents.participantId, participantId)).all();
const exposuresOf = (interventionId: string) =>
  db.select().from(schema.offerExposures).where(eq(schema.offerExposures.interventionId, interventionId)).all();
const eventsOf = (participantId: string) =>
  db.select().from(schema.learnerModelEvents).where(eq(schema.learnerModelEvents.participantId, participantId)).all();

const V23_TABLES = [
  schema.groupStateEstimates,
  schema.privateDecisionTraces,
  schema.scaffoldingStateEvents,
  schema.offerExposures,
  schema.interventionOutcomeEvaluations,
  schema.interventionProgressFeedback,
] as const;

function v23RowCount(sessionId: string) {
  return V23_TABLES.reduce(
    (sum, table) => sum + db.select().from(table).where(eq(table.sessionId, sessionId)).all().length,
    0
  );
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

function exposure(group: TestGroup, index: number, interventionId: string, body: Record<string, unknown>, code = group.session.code) {
  const member = group.members[index];
  return exposureRoute(
    apiRequest(`/api/sessions/${code}/interventions/${interventionId}/exposure`, {
      method: "POST",
      token: member.token,
      body: { participantId: member.participant.id, ...body },
    }),
    routeParams({ code, id: interventionId })
  );
}

function progress(group: TestGroup, index: number, interventionId: string, response: unknown) {
  const member = group.members[index];
  return progressRoute(
    apiRequest(`/api/sessions/${group.session.code}/interventions/${interventionId}/progress`, {
      method: "POST",
      token: member.token,
      body: { participantId: member.participant.id, response },
    }),
    routeParams({ code: group.session.code, id: interventionId })
  );
}

function stop(group: TestGroup, index: number, interventionId?: string) {
  const member = group.members[index];
  return interventionsRoute(
    apiRequest(`/api/sessions/${group.session.code}/interventions`, {
      method: "POST",
      token: member.token,
      body: { participantId: member.participant.id, scenarioOrder: 1, kind: "stop_proactive_for_scenario", interventionId },
    }),
    routeParams({ code: group.session.code })
  );
}

async function submitScenario(group: TestGroup, orchestrator: InterventionOrchestrator, clock: TestClock, order: number) {
  const [first] = group.members;
  await updateAttemptFields(group.session.id, order, { finalAnswer: "Our answer" }, null, [], first.participant.id);
  for (const member of group.members) await setParticipantReady(group.session.id, order, member.participant.id, true);
  db.update(schema.scenarioAttempts)
    .set({ finalAnswerAt: clock.advance(1).toISOString() })
    .where(eq(schema.scenarioAttempts.id, attemptFor(group.session.id, order)!.id))
    .run();
  await orchestrator.onScenarioSubmitted({ sessionId: group.session.id, sessionCode: group.session.code, scenarioOrder: order });
}

/** A proactive_adaptive group on policy-v2-3 where member A has just written that they are unsure. */
async function confusedMemberGroup(patchA: Partial<LearnerState> = EAGER) {
  const group = await createV2Group({ condition: "proactive_adaptive", policyVersion: V23 });
  const ctx = setup();
  primeModel(group, 0, patchA, ctx.clock);
  primeModel(group, 1, RELUCTANT, ctx.clock);
  await getOrCreateAttempt(group.session.id, 1);
  setOnline(group, [0, 1], ctx.clock.current);
  await say(group, 1, "Option B protects the budget because staff costs keep rising", ctx.clock.advance(1));
  await say(group, 0, "I'm confused, I don't understand why the budget matters here", ctx.clock.advance(3));
  ctx.clock.advance(1);
  return { group, ...ctx };
}

beforeEach(() => {
  resetPresence();
  resetExposureRateLimits();
});

describe("V2.3 group decisions", () => {
  test("worked trace 1: productive disagreement leads to no group action", async () => {
    const group = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    const { clock, orchestrator } = setup();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I think option A is better because it protects the patients privacy", clock.advance(2));
    await say(group, 1, "I disagree, option B is stronger because the hospital budget matters more", clock.advance(4));
    await say(group, 0, "But what about long-term trust? For example people stop sharing data", clock.advance(4));
    await say(group, 1, "No, the evidence shows budgets decide which clinics stay open next year", clock.advance(3));
    clock.advance(1);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);

    assert.equal(outcome!.decision.action, "no_action");
    assert.equal(outcome!.decision.reasonCode, "context_constructive_disagreement");
    assert.equal(groupRows(group.session.id).length, 0);
    const [estimate] = db
      .select()
      .from(schema.groupStateEstimates)
      .where(eq(schema.groupStateEstimates.sessionId, group.session.id))
      .all();
    assert.equal(estimate.state, "constructive_disagreement");
    assert.equal(estimate.evaluationId, outcome!.evaluationId);
    assert.equal(estimate.policyVersion, V23);
    assert.ok(estimate.evidence.length > 0);
  });

  test("worked trace 2: a genuine stall leads to a shared prompt; its outcome is observed, not learned per member", async () => {
    const group = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    const { clock, orchestrator } = setup();
    const [a, b] = group.members.map((m) => m.participant);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I think the first option is risky because of the cost", clock.advance(1));
    await say(group, 1, "ok", clock.advance(1));
    clock.advance(10);
    const emits = captureEmits();
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);

    assert.equal(outcome!.decision.action, "offer");
    const offer = outcome!.intervention!;
    assert.equal(offer.scope, "group");
    assert.equal(offer.trigger, "stalled_discussion");
    assert.equal(offer.status, "suggested");
    const offered = emits.filter((e) => e.event === "intervention:offered");
    assert.equal(offered.length, 1);
    assert.ok(!offered[0].target.startsWith("participant:"), "a shared prompt goes to the group room");
    const created = exposuresOf(offer.id).filter((e) => e.kind === "server_created");
    assert.deepEqual(created.map((e) => e.participantId).sort(), [a.id, b.id].sort());

    const view = await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "accepted"));
    assert.equal(view.status, "delivered");
    const attempt = attemptFor(group.session.id)!;
    assert.ok(listVisibleInterventions(attempt.id, b.id, group.session.id, 0).some((i) => i.id === offer.id && i.content));

    await say(group, 1, "Let's compare the long-term costs then", clock.advance(2));
    await say(group, 0, "Good idea, I will list the staffing risks", clock.advance(2));
    clock.advance(10);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [observed] = db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(eq(schema.interventionOutcomeEvaluations.interventionId, offer.id))
      .all();
    assert.equal(observed.subjectKey, "group");
    assert.equal(observed.difficultyResolved, "yes");
    assert.equal(observed.wasVisible, true);
    assert.equal(observed.understandingEvidence, "not_assessed");
    assert.equal(observed.updateApplied, false, "group outcomes never update a member's learner model");
    assert.equal(eventsOf(a.id).length + eventsOf(b.id).length, 0);
  });

  test("dismissing a shared suggestion hides it only for that member until every active member dismissed it", async () => {
    const group = await createV2Group({ condition: "proactive_group", policyVersion: V23, members: 3 });
    const { clock, orchestrator } = setup();
    const [a, b, c] = group.members.map((m) => m.participant);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1, 2], clock.current);
    clock.advance(5);
    const offer = (await orchestrator.evaluateAttempt(group.session.id, 1))!.intervention!;
    assert.equal(offer.trigger, "initial_silence");

    const emits = captureEmits();
    const mine = await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "dismissed"));
    assert.equal(mine.status, "suggested");
    assert.equal(mine.myFeedback, "dismissed");
    const attempt = attemptFor(group.session.id)!;
    const forB = listVisibleInterventions(attempt.id, b.id, group.session.id, 0).find((i) => i.id === offer.id)!;
    assert.equal(forB.status, "suggested");
    assert.equal(forB.myFeedback, null);
    for (const emit of emits.filter((e) => !e.target.startsWith("participant:"))) {
      const text = JSON.stringify(emit.payload);
      assert.ok(!text.includes(a.id) && !text.includes(a.anonymousId) && !text.includes(a.displayName), "no member-specific status on group broadcasts");
    }
    assert.ok(!emits.some((e) => e.event === "intervention:state"));

    await orchestrator.handlePrivateOfferResponse(respond(group, 1, offer.id, "dismissed"));
    assert.equal(interventionRows(group.session.id).find((r) => r.id === offer.id)!.status, "suggested");
    const last = await orchestrator.handlePrivateOfferResponse(respond(group, 2, offer.id, "dismissed"));
    assert.equal(last.status, "dismissed");
    assert.ok(exposuresOf(offer.id).some((e) => e.participantId === c.id && e.kind === "dismissed"));

    const older = await createV2Group({ condition: "proactive_group" });
    await getOrCreateAttempt(older.session.id, 1);
    setOnline(older, [0, 1], clock.current);
    clock.advance(5);
    const olderOffer = (await orchestrator.evaluateAttempt(older.session.id, 1))!.intervention!;
    const closed = await orchestrator.handlePrivateOfferResponse(respond(older, 0, olderOffer.id, "dismissed"));
    assert.equal(closed.status, "dismissed", "policy-v2-2-style groups keep first-dismissal-closes");
    assert.equal(v23RowCount(older.session.id), 0, "older policies write no V2.3 rows");
  });
});

describe("V2.3 private help (proactive_adaptive)", () => {
  test("worked trace 3: private confusion gets a minimal nudge; 'No' feedback escalates; an explanation may follow", async () => {
    const { group, clock, orchestrator } = await confusedMemberGroup({ ...EAGER, arms: { guiding_question: STRONG, hint: WEAK, explanation: STRONG } });
    const [a, b] = group.members.map((m) => m.participant);
    const emits = captureEmits();
    await orchestrator.evaluateAttempt(group.session.id, 1);

    assert.equal(groupRows(group.session.id).length, 0, "one member's confusion is not a group prompt");
    const [nudge] = adaptiveRows(group.session.id);
    assert.equal(nudge.recipientParticipantId, a.id);
    assert.equal(nudge.supportType, "guiding_question");
    assert.equal(nudge.scaffoldLevel, "1");
    assert.equal(nudge.content, null, "no AI text before the member says yes");
    assert.deepEqual(
      emits.filter((e) => JSON.stringify(e.payload).includes(nudge.id)).map((e) => e.target),
      [`participant:${a.id}`]
    );
    const aTrace = tracesOf(a.id).find((t) => t.interventionId === nudge.id)!;
    assert.equal(aTrace.action, "offer");
    assert.equal(aTrace.tier, "minimal");
    assert.equal(aTrace.move, "offer_minimal");
    assert.ok(aTrace.groupStateEstimateId);
    const [bTrace] = tracesOf(b.id);
    assert.equal(bTrace.action, "wait");
    assert.equal(bTrace.reasonCode, "need_not_corroborated");

    await orchestrator.handlePrivateOfferResponse(respond(group, 0, nudge.id, "accepted"));
    assert.equal((await progress(group, 1, nudge.id, "no")).status, 404, "another member cannot answer for A");
    const answered = await progress(group, 0, nudge.id, "no");
    assert.equal(answered.status, 200);
    assert.deepEqual(await answered.json(), { response: "no", duplicate: false });
    assert.equal(modelOf(a.id).arms.guiding_question.beta, STRONG.beta + 1);
    const escalation = scaffoldingOf(a.id).find((e) => e.eventType === "escalation")!;
    assert.equal(escalation.toTier, "moderate");
    assert.equal(escalation.reasonCode, "minimal_help_insufficient:member_said_help_was_not_enough");
    const again = await progress(group, 0, nudge.id, "yes");
    assert.deepEqual(await again.json(), { response: "no", duplicate: true });
    assert.equal(modelOf(a.id).arms.guiding_question.beta, STRONG.beta + 1, "one answer per member and suggestion");

    await say(group, 0, "I'm still confused, I don't get how staff costs connect", clock.advance(5));
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const escalated = adaptiveRows(group.session.id).find((r) => r.id !== nudge.id)!;
    assert.equal(escalated.supportType, "explanation");
    assert.equal(escalated.scaffoldLevel, "2");
    const escalatedTrace = tracesOf(a.id).find((t) => t.interventionId === escalated.id)!;
    assert.equal(escalatedTrace.tier, "moderate");
    assert.equal(escalatedTrace.move, "escalate");

    clock.advance(10);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [observed] = db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(eq(schema.interventionOutcomeEvaluations.interventionId, nudge.id))
      .all();
    assert.equal(observed.subjectKey, a.id);
    assert.equal(observed.resolutionSource, "feedback");
    assert.equal(observed.difficultyResolved, "no");
    assert.equal(observed.wasVisible, true);
    assert.equal(modelOf(a.id).arms.guiding_question.beta, STRONG.beta + 1, "feedback is not counted twice");

    const declined = await orchestrator.handlePrivateOfferResponse(respond(group, 0, escalated.id, "dismissed"));
    assert.equal(declined.status, "dismissed", "the escalation stays optional");
  });

  test("worked trace 4: independent work fades proactive help; the member's own 'I'm unsure' still gets a minimal offer", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive", policyVersion: V23 });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    for (const order of [1, 2]) {
      await getOrCreateAttempt(group.session.id, order);
      await say(group, 0, `My own reasoning for case ${order}, because the evidence is clear`, clock.advance(2), order);
      await submitScenario(group, orchestrator, clock, order);
    }
    const independent = eventsOf(a.id).filter((e) => e.eventType === "scenario_outcome");
    assert.deepEqual(
      independent.map((e) => (e.detail as { outcome?: string }).outcome),
      ["independent", "independent"]
    );

    await getOrCreateAttempt(group.session.id, 3);
    setOnline(group, [0, 1], clock.current, 3);
    clock.advance(5);
    await orchestrator.evaluateAttempt(group.session.id, 3);
    assert.equal(adaptiveRows(group.session.id, 3).length, 0);
    assert.ok(groupRows(group.session.id).some((r) => r.scenarioOrder === 3), "the group still gets its process prompt");
    const fade = scaffoldingOf(a.id).find((e) => e.eventKey === "fade_start:3")!;
    assert.equal(fade.toTier, "no_offer");
    assert.equal(fade.reasonCode, "independent_scenarios_before");
    const waited = tracesOf(a.id).filter((t) => t.scenarioOrder === 3);
    assert.equal(waited[0].reasonCode, "faded_after_independent_work");
    assert.equal(waited[0].tier, "no_offer");

    await say(group, 0, "I'm confused, I don't understand this third case", clock.advance(1), 3);
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 3);
    const [explicit] = adaptiveRows(group.session.id, 3);
    assert.equal(explicit.recipientParticipantId, a.id);
    assert.equal(explicit.scaffoldLevel, "1");
    const trace = tracesOf(a.id).find((t) => t.interventionId === explicit.id)!;
    assert.equal(trace.tier, "no_offer");
    assert.equal(trace.move, "offer_minimal");
  });

  test("a popup that expires unseen, or seen but unanswered, teaches the model nothing", async () => {
    const { group, clock, orchestrator } = await confusedMemberGroup();
    const a = group.members[0].participant;
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [first] = adaptiveRows(group.session.id);
    const before = modelOf(a.id).receptiveness;
    clock.advance(21);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(interventionRows(group.session.id).find((r) => r.id === first.id)!.status, "expired");
    assert.ok(exposuresOf(first.id).some((e) => e.kind === "expired_unseen"));
    const expiredEvent = eventsOf(a.id).find((e) => e.eventKey === `response:${first.id}`)!;
    assert.equal(expiredEvent.reward, null);
    assert.equal((expiredEvent.detail as { updateApplied?: boolean }).updateApplied, false);
    assert.deepEqual(modelOf(a.id).receptiveness, before);
    assert.equal(adaptiveRows(group.session.id).length, 1, "the same evidence is not offered twice");
    const repeat = tracesOf(a.id).sort((x, y) => x.decidedAt.localeCompare(y.decidedAt)).at(-1)!;
    assert.equal(repeat.action, "wait");
    assert.equal(repeat.reasonCode, "already_offered_for_this_evidence");

    await say(group, 0, "I'm still confused, I don't understand the cost part", clock.advance(1));
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const second = adaptiveRows(group.session.id).find((r) => r.id !== first.id)!;
    assert.ok(second, "a new message of the member is new evidence");
    const shown = await exposure(group, 0, second.id, { kind: "client_displayed_in_viewport", clientAt: clock.current.toISOString() });
    assert.equal(shown.status, 200);
    clock.advance(21);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.ok(exposuresOf(second.id).some((e) => e.kind === "expired_seen"));
    assert.equal(eventsOf(a.id).find((e) => e.eventKey === `response:${second.id}`)!.reward, null);
    assert.deepEqual(modelOf(a.id).receptiveness, before);
  });

  test("'Don't suggest again in this scenario' stops popups for that member only", async () => {
    const { group, clock, orchestrator } = await confusedMemberGroup();
    const [a, b] = group.members.map((m) => m.participant);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);

    assert.equal((await stop(group, 1, offer.id)).status, 404, "B cannot stop A's suggestion");
    const stopped = await stop(group, 0, offer.id);
    assert.equal(stopped.status, 200);
    const body = await stopped.json();
    assert.equal(body.stopped, true);
    assert.equal(body.intervention.status, "dismissed");
    assert.ok(scaffoldingOf(a.id).some((e) => e.eventType === "preference_stop"));
    assert.equal(learningAwareMemberState(group.assignment, a.id, 1)!.proactiveStopped, true);
    assert.equal(learningAwareMemberState(group.assignment, b.id, 1)!.proactiveStopped, false);

    await say(group, 0, "I'm confused again, I don't understand the second part", clock.advance(6));
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).length, 1);
    const latest = tracesOf(a.id).sort((x, y) => x.decidedAt.localeCompare(y.decidedAt)).at(-1)!;
    assert.equal(latest.reasonCode, "member_preference_stop");
  });
});

describe("Exposure, progress and stop routes", () => {
  test("only the authenticated recipient can report exposure; replays, closed offers and floods are rejected", async () => {
    const { group, clock, orchestrator } = await confusedMemberGroup();
    const [a, b] = group.members;
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    const url = `/api/sessions/${group.session.code}/interventions/${offer.id}/exposure`;
    const params = routeParams({ code: group.session.code, id: offer.id });

    const anonymous = await exposureRoute(
      apiRequest(url, { method: "POST", body: { participantId: a.participant.id, kind: "socket_delivered" } }),
      params
    );
    assert.equal(anonymous.status, 401);
    const spoofed = await exposureRoute(
      apiRequest(url, { method: "POST", token: b.token, body: { participantId: a.participant.id, kind: "socket_delivered" } }),
      params
    );
    assert.equal(spoofed.status, 401, "a client-supplied member id is not proof of identity");
    assert.equal((await exposure(group, 1, offer.id, { kind: "socket_delivered" })).status, 404);
    assert.equal((await exposure(group, 0, offer.id, { kind: "read" })).status, 400);
    assert.equal((await exposure(group, 0, offer.id, { kind: "indicator_dismissed" })).status, 400);

    const shown = await exposure(group, 0, offer.id, { kind: "client_displayed_in_viewport", clientAt: clock.current.toISOString() });
    assert.deepEqual(await shown.json(), { recorded: true, duplicate: false });
    const replay = await exposure(group, 0, offer.id, { kind: "client_displayed_in_viewport", clientAt: clock.current.toISOString() });
    assert.deepEqual(await replay.json(), { recorded: false, duplicate: true });
    await exposure(group, 0, offer.id, { kind: "user_opened", clientAt: "2000-01-01T00:00:00.000Z" });
    const opened = exposuresOf(offer.id).find((e) => e.kind === "user_opened")!;
    assert.equal(opened.clientClockRejected, true);
    assert.equal(opened.clientAt, null);

    const other = await createV2Group({ condition: "proactive_adaptive", policyVersion: V23 });
    assert.equal((await exposure(other, 0, offer.id, { kind: "socket_delivered" })).status, 404, "other-room ids are not found");
    assert.equal(
      (await exposure(other, 0, offer.id, { kind: "socket_delivered" }, group.session.code)).status,
      403,
      "a member of another group cannot post into this one"
    );

    assert.equal((await progress(group, 0, offer.id, "maybe")).status, 400);
    assert.equal((await progress(group, 0, offer.id, "yes")).status, 409, "feedback only after delivery");

    await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "dismissed"));
    assert.equal((await exposure(group, 0, offer.id, { kind: "socket_delivered" })).status, 409, "closed offers are rejected");

    await say(group, 0, "I'm confused, I don't understand the second part either", clock.advance(6));
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const next = adaptiveRows(group.session.id).find((r) => r.id !== offer.id)!;
    let status = 200;
    for (let i = 0; i < 70 && status !== 429; i++) {
      status = (await exposure(group, 0, next.id, { kind: "socket_delivered" })).status;
    }
    assert.equal(status, 429);
  });

  test("groups on older policies refuse the V2.3 routes and write no V2.3 rows", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const { clock, orchestrator } = setup();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    const offer = (await orchestrator.evaluateAttempt(group.session.id, 1))!.intervention!;
    await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "accepted"));
    assert.equal((await exposure(group, 0, offer.id, { kind: "socket_delivered" })).status, 409);
    assert.equal((await progress(group, 0, offer.id, "yes")).status, 409);
    assert.equal((await stop(group, 0)).status, 409);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(v23RowCount(group.session.id), 0);

    const shared = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    assert.equal((await stop(shared, 0)).status, 409, "the stop option exists only with adaptive private help");
  });
});

describe("V2.3 research data", () => {
  test("V2.3 exports carry provenance and only anonymous ids; group views never contain private offers", async () => {
    const { group, clock, orchestrator } = await confusedMemberGroup();
    const [a, b] = group.members.map((m) => m.participant);
    const emits = captureEmits();
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    await orchestrator.handlePrivateOfferResponse(respond(group, 0, offer.id, "accepted"));
    await progress(group, 0, offer.id, "yes");
    clock.advance(12);
    await orchestrator.evaluateAttempt(group.session.id, 1);

    for (const emit of emits.filter((e) => e.target !== `participant:${a.id}`)) {
      assert.ok(!JSON.stringify(emit.payload).includes(offer.id), `private offer leaked to ${emit.target}`);
    }
    const attempt = attemptFor(group.session.id)!;
    assert.ok(!listVisibleInterventions(attempt.id, b.id, group.session.id, 0).some((i) => i.id === offer.id));
    assert.deepEqual(learningAwareMemberState(group.assignment, b.id, 1)!.progressFeedback, {});
    assert.deepEqual(learningAwareMemberState(group.assignment, a.id, 1)!.progressFeedback, { [offer.id]: "yes" });

    const secrets = group.members.flatMap((m) => [m.participant.id, m.participant.displayName, m.token]);
    for (const type of Object.keys(V23_EXPORTS) as V23ExportType[]) {
      const { columns, rows } = buildV23Export(type, [group.session.id]);
      assert.deepEqual(columns.slice(0, 4), ["export_schema_version", "group", "research_condition", "intervention_policy_version"]);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), type);
        assert.equal(row.intervention_policy_version, V23);
        const text = JSON.stringify(row);
        for (const secret of secrets) assert.ok(!text.includes(secret), `${type} contains an internal id, nickname or token`);
      }
    }
    const decisions = buildV23Export("v2_3_private_decisions", [group.session.id]).rows;
    assert.ok(decisions.some((r) => r.student_id === a.anonymousId && r.action === "offer"));
    const funnel = buildV23Export("v2_3_offer_funnel", [group.session.id]).rows.find((r) => r.intervention_id === offer.id)!;
    assert.equal(funnel.seen, "yes");
    assert.equal(funnel.content_delivered, "yes");
    assert.equal(funnel.progress_feedback, "yes");

    const dashboard = buildV23Dashboard(group.session.id)!;
    assert.ok(dashboard);
    const legacy = await createLegacyGroup(1);
    assert.equal(buildV23Dashboard(legacy.session.id), null);
  });

  test("blind review windows are pseudonymized; labels give agreement statistics; admin only", async () => {
    const group = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    const { clock, orchestrator } = setup();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "Member2, what do you think about option A?", clock.advance(1));
    await say(group, 1, "Option A works because it keeps costs low", clock.advance(1));
    await orchestrator.evaluateAttempt(group.session.id, 1);
    clock.advance(12);
    await orchestrator.evaluateAttempt(group.session.id, 1);

    const admin = (url: string, init: { method?: string; body?: unknown } = {}) =>
      new Request(`http://localhost${url}`, {
        method: init.method ?? "GET",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    assert.equal((await reviewGet(new Request(`http://localhost/api/admin/v2-3/review?session=${group.session.code}`))).status, 401);
    const blind = await (await reviewGet(admin(`/api/admin/v2-3/review?session=${group.session.code}&mode=sample`))).json();
    assert.ok(blind.windows.length >= 2);
    for (const window of blind.windows) {
      assert.equal(window.system, undefined, "blind windows carry no system decision");
      const text = JSON.stringify(window.messages);
      for (const m of group.members) assert.ok(!text.includes(m.participant.displayName));
    }
    assert.ok(JSON.stringify(blind.windows).includes("Member B, what do you think"));
    const open = await (await reviewGet(admin(`/api/admin/v2-3/review?session=${group.session.code}&mode=sample&blind=false`))).json();
    assert.ok(open.windows.every((w: { system?: unknown }) => w.system));

    const target = blind.windows[0].targetId;
    for (const [raterId, necessity] of [
      ["rater-1", "necessary"],
      ["rater-2", "unnecessary"],
    ]) {
      const saved = await reviewPost(
        admin("/api/admin/v2-3/review", {
          method: "POST",
          body: { session: group.session.code, targetType: "evaluation", targetId: target, raterId, necessity, stateLabel: "possible_stall" },
        })
      );
      assert.equal(saved.status, 200);
    }
    const bad = await reviewPost(
      admin("/api/admin/v2-3/review", {
        method: "POST",
        body: { session: group.session.code, targetType: "evaluation", targetId: target, raterId: "r", necessity: "maybe" },
      })
    );
    assert.equal(bad.status, 400);
    const other = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    const foreign = await reviewPost(
      admin("/api/admin/v2-3/review", {
        method: "POST",
        body: { session: other.session.code, targetType: "evaluation", targetId: target, raterId: "r", necessity: "necessary" },
      })
    );
    assert.equal(foreign.status, 404);
    const legacy = await createLegacyGroup(1);
    assert.equal((await reviewGet(admin(`/api/admin/v2-3/review?session=${legacy.session.code}`))).status, 400);

    const agreement = await (await reviewGet(admin(`/api/admin/v2-3/review?session=${group.session.code}&mode=agreement`))).json();
    assert.equal(agreement.labels, 2);
    assert.equal(agreement.humanVsHuman.necessity.n, 1);
    assert.equal(agreement.humanVsHuman.necessity.percentAgreement, 0);
    assert.equal(agreement.systemVsHuman.necessity.n, 2);
    assert.equal(buildV23Export("v2_3_review_labels", [group.session.id]).rows.length, 2);
  });

  test("the open-answer rubric is off by default and never changes the assessment", async () => {
    const group = await createV2Group({ condition: "proactive_group", policyVersion: V23 });
    const admin = (url: string, init: { method?: string; body?: unknown } = {}) =>
      new Request(`http://localhost${url}`, {
        method: init.method ?? "GET",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    assert.equal((await rubricGet(admin(`/api/admin/v2-3/open-rubric?session=${group.session.code}`))).status, 404);

    const a = group.members[0].participant;
    const pre = db
      .select()
      .from(schema.assessments)
      .where(and(eq(schema.assessments.participantId, a.id), eq(schema.assessments.assessmentType, "pre")))
      .get()!;
    db.update(schema.assessments)
      .set({ openAnswers: { open_ai_role: "The AI should ask a question so the group compares its reasons." } })
      .where(eq(schema.assessments.id, pre.id))
      .run();
    const before = db.select().from(schema.assessments).where(eq(schema.assessments.id, pre.id)).get()!;

    const saved = process.env.ADAPTIVE_V2_OPEN_ANSWER_RUBRIC;
    process.env.ADAPTIVE_V2_OPEN_ANSWER_RUBRIC = "true";
    try {
      const listed = await (await rubricGet(admin(`/api/admin/v2-3/open-rubric?session=${group.session.code}`))).json();
      assert.equal(listed.answers.length, 1);
      assert.equal(listed.answers[0].studentId, undefined, "blind by default");
      const scored = await rubricPost(
        admin("/api/admin/v2-3/open-rubric", {
          method: "POST",
          body: {
            session: group.session.code,
            assessmentId: pre.id,
            raterId: "rater-1",
            criteria: { recognizes_difficulty: 1, appropriate_ai_scope: 1, justified_timing: 0, preserves_autonomy: 1 },
          },
        })
      );
      assert.equal(scored.status, 200);
      assert.equal((await scored.json()).score.openApplicationRubricScore, 3);
    } finally {
      if (saved === undefined) delete process.env.ADAPTIVE_V2_OPEN_ANSWER_RUBRIC;
      else process.env.ADAPTIVE_V2_OPEN_ANSWER_RUBRIC = saved;
    }
    const after = db.select().from(schema.assessments).where(eq(schema.assessments.id, pre.id)).get()!;
    assert.deepEqual(after, before);
    const [row] = buildV23Export("v2_3_open_rubric", [group.session.id]).rows;
    assert.equal(row.open_application_rubric_score, 3);
    assert.equal(row.student_id, a.anonymousId);
  });

  test("the integrity checker passes on V2.3 data, including the V2.3 checks", () => {
    const result = spawnSync(process.execPath, [path.join("scripts", "verify-research-integrity.mjs"), TEST_DATABASE_FILE, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout) as { results: { check: string; severity: string; count: number }[] };
    for (const check of [
      "v2_3_rows_for_older_policies",
      "v2_3_private_leak",
      "v2_3_member_group",
      "v2_3_learning_from_unseen_or_group",
      "v2_3_understanding_claim",
    ]) {
      const found = report.results.find((r) => r.check === check);
      assert.ok(found, `${check} ran`);
      assert.equal(found.count, 0, check);
    }
  });
});
