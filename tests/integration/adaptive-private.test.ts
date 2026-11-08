import { TEST_DATABASE_FILE } from "../helpers/testDb";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST as surveyRoute } from "@/app/api/sessions/[code]/survey/route";
import { PersonalInterventionCoach } from "@/lib/ai/PersonalInterventionCoach";
import { db, schema } from "@/lib/db";
import type { LearnerState } from "@/lib/intervention/adaptive/LearnerModel";
import { learnerStore } from "@/lib/intervention/adaptive/LearnerModelStore";
import { discussionCoordinator } from "@/lib/intervention/GroupDiscussionCoordinator";
import { InterventionOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { getPolicy } from "@/lib/intervention/policies";
import { resetPresence } from "@/lib/intervention/presence";
import { EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import type { ResearchCondition } from "@/lib/intervention/types";
import { captureEmits } from "@/lib/realtime/emit";
import { listVisibleInterventions } from "@/lib/services/interventions";
import { getOrCreateAttempt, saveIndividualScaffold, setParticipantReady, updateAttemptFields } from "@/lib/services/sessions";
import { buildGroupExport, EXPORT_BUILDERS, type ExportType } from "@/lib/utils/export";
import { buildV2Dashboard, buildV2Export } from "@/lib/utils/exportV2";
import {
  apiRequest,
  attemptFor,
  CountingFacilitator,
  createV2Group,
  interventionRows,
  routeParams,
  say,
  setOnline,
  TEST_POLICY,
  TestClock,
  type TestGroup,
} from "../helpers/fixtures";

class CountingCoach extends PersonalInterventionCoach {
  calls = 0;
  constructor() {
    super(
      async () => {
        throw new Error("no real provider in tests");
      },
      () => false
    );
  }
  override async generatePrivateSupport(input: Parameters<PersonalInterventionCoach["generatePrivateSupport"]>[0]) {
    this.calls++;
    return super.generatePrivateSupport(input);
  }
}

function setup(clock = new TestClock()) {
  const coach = new CountingCoach();
  const orchestrator = new InterventionOrchestrator({ clock: clock.now, facilitator: new CountingFacilitator(), coach });
  return { clock, coach, orchestrator };
}

const STRONG = { alpha: 500, beta: 1 };
const WEAK = { alpha: 1, beta: 500 };
/** Concentrated posteriors make the Thompson draws effectively deterministic. */
const EAGER: Partial<LearnerState> = {
  receptiveness: STRONG,
  independence: WEAK,
  arms: { guiding_question: STRONG, hint: WEAK, explanation: WEAK },
};
const RELUCTANT: Partial<LearnerState> = { receptiveness: WEAK, independence: STRONG };

function primeModel(group: TestGroup, index: number, patch: Partial<LearnerState>, clock: TestClock) {
  const policy = getPolicy(TEST_POLICY);
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

const adaptiveRows = (sessionId: string) => interventionRows(sessionId).filter((r) => r.reasonCode === "adaptive_private");
const modelOf = (participantId: string) => learnerStore.get(participantId)!.state;
const eventsOf = (participantId: string) =>
  db.select().from(schema.learnerModelEvents).where(eq(schema.learnerModelEvents.participantId, participantId)).all();

function input(group: TestGroup, index: number, interventionId: string, action: "accepted" | "dismissed" | "deferred") {
  return {
    session: group.session,
    assignment: group.assignment,
    participant: group.members[index].participant,
    scenarioOrder: 1,
    interventionId,
    action,
  };
}

async function submitScenario(group: TestGroup, orchestrator: InterventionOrchestrator, clock: TestClock) {
  const [first] = group.members;
  await updateAttemptFields(group.session.id, 1, { finalAnswer: "Our answer" }, null, [], first.participant.id);
  for (const member of group.members) await setParticipantReady(group.session.id, 1, member.participant.id, true);
  // Submission stamps real time; keep it after the fake-clock events of the test.
  db.update(schema.scenarioAttempts)
    .set({ finalAnswerAt: clock.advance(1).toISOString() })
    .where(eq(schema.scenarioAttempts.id, attemptFor(group.session.id)!.id))
    .run();
  await orchestrator.onScenarioSubmitted({ sessionId: group.session.id, sessionCode: group.session.code, scenarioOrder: 1 });
}

beforeEach(() => resetPresence());

describe("Adaptive private suggestions (proactive_adaptive)", () => {
  test("a popup goes privately to the member whose own model says they need it; the AI runs only after Yes, once", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive", members: 3 });
    const { clock, coach, orchestrator } = setup();
    const [a, b, c] = group.members.map((m) => m.participant);
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    primeModel(group, 2, EAGER, clock);
    const emits = captureEmits();
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");

    const rows = adaptiveRows(group.session.id);
    assert.equal(rows.length, 1, "only the eager, connected member gets a popup");
    const [offer] = rows;
    assert.equal(offer.recipientParticipantId, a.id);
    assert.equal(offer.scope, "individual");
    assert.equal(offer.trigger, "adaptive_need");
    assert.equal(offer.initiatedBy, "system");
    assert.equal(offer.status, "suggested");
    assert.equal(offer.content, null);
    assert.equal(offer.supportType, "guiding_question");
    assert.equal(offer.scaffoldLevel, "1");
    assert.equal(offer.expiresAt, new Date(clock.current.getTime() + 20_000).toISOString());
    assert.match(offer.reasonExplanation ?? "", /Only you can see this/);
    assert.equal(coach.calls, 0);

    const offered = emits.filter((e) => e.event === "intervention:offered" && (e.payload as { id: string }).id === offer.id);
    assert.deepEqual(
      offered.map((e) => e.target),
      [`participant:${a.id}`]
    );
    const attempt = attemptFor(group.session.id)!;
    assert.ok(listVisibleInterventions(attempt.id, a.id, group.session.id, 0).some((i) => i.id === offer.id));
    assert.ok(!listVisibleInterventions(attempt.id, b.id, group.session.id, 0).some((i) => i.id === offer.id));
    assert.ok(!listVisibleInterventions(attempt.id, c.id, group.session.id, 0).some((i) => i.id === offer.id));

    const decision = db
      .select()
      .from(schema.scaffoldRecommendations)
      .where(eq(schema.scaffoldRecommendations.interventionId, offer.id))
      .get()!;
    assert.equal(decision.engineVersion, "adaptive-bandit-v1");
    assert.equal(decision.recommendedSupportType, "guiding_question");
    assert.ok((decision.evidence as { seed?: string }).seed);

    await assert.rejects(orchestrator.handlePrivateOfferResponse(input(group, 1, offer.id, "accepted")), (error: unknown) => {
      assert.ok(error instanceof EligibilityError);
      assert.equal(error.code, "not_found");
      return true;
    });

    const view = await orchestrator.handlePrivateOfferResponse(input(group, 0, offer.id, "accepted"));
    assert.equal(view.status, "delivered");
    assert.ok(view.content);
    await orchestrator.handlePrivateOfferResponse(input(group, 0, offer.id, "accepted"));
    assert.equal(coach.calls, 1);
    const resolved = db
      .select()
      .from(schema.scaffoldRecommendations)
      .where(eq(schema.scaffoldRecommendations.interventionId, offer.id))
      .get()!;
    assert.equal(resolved.chosenSupportType, "guiding_question");

    const responses = () => eventsOf(a.id).filter((e) => e.eventType === "offer_response");
    assert.equal(responses().length, 1);
    assert.equal(responses()[0].reward, 1);
    assert.equal(modelOf(a.id).receptiveness.alpha, STRONG.alpha + 1);

    await say(group, 0, "I think the long-term costs matter most here", clock.advance(3));
    clock.advance(10);
    await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");
    await orchestrator.evaluateAttempt(group.session.id, 1, "scheduler");
    assert.equal(responses().length, 1, "each reward is applied once");
    const outcomes = eventsOf(a.id).filter((e) => e.eventType === "help_outcome");
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].reward, 1);
    assert.equal(modelOf(a.id).arms.guiding_question.alpha, STRONG.alpha + 1);

    assert.equal(eventsOf(b.id).filter((e) => e.eventType !== "model_created" && e.eventType !== "pace_gaps").length, 0);
    assert.equal(adaptiveRows(group.session.id).filter((r) => r.recipientParticipantId !== a.id).length, 0);
  });

  test("'No thanks', 'Not now' and expiry each teach the model; at most two popups per scenario", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [first] = adaptiveRows(group.session.id);
    const dismissed = await orchestrator.handlePrivateOfferResponse(input(group, 0, first.id, "dismissed"));
    assert.equal(dismissed.status, "dismissed");
    assert.equal(modelOf(a.id).receptiveness.beta, WEAK.alpha + 1);

    clock.advance(6);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const second = adaptiveRows(group.session.id).find((r) => r.id !== first.id)!;
    assert.ok(second, "a new draw after the model changed may offer again");
    await orchestrator.handlePrivateOfferResponse(input(group, 0, second.id, "deferred"));
    const closed = adaptiveRows(group.session.id).find((r) => r.id === second.id)!;
    assert.equal(closed.status, "deferred");
    assert.ok(closed.resolvedAt);
    assert.equal(closed.expiresAt, null);
    const deferredEvent = eventsOf(a.id).find((e) => e.eventKey === `response:${second.id}`)!;
    assert.equal(deferredEvent.weight, 0.5);
    assert.ok(deferredEvent.stateAfter.pace.observations > deferredEvent.stateBefore!.pace.observations);

    clock.advance(6);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).length, 2, "the per-scenario limit is fixed");

    await submitScenario(group, orchestrator, clock);
    assert.equal(adaptiveRows(group.session.id).find((r) => r.id === second.id)?.status, "deferred");
    const scenarioEvents = eventsOf(a.id).filter((e) => e.eventType === "scenario_outcome");
    assert.equal(scenarioEvents.length, 1);
    assert.equal(scenarioEvents[0].eventKey, "scenario:1");

    const before = modelOf(a.id).receptiveness.beta;
    orchestrator.onSurveyRated({ assignment: group.assignment, participantId: a.id, scenarioOrder: 1, supportAmount: "too_much" });
    orchestrator.onSurveyRated({ assignment: group.assignment, participantId: a.id, scenarioOrder: 1, supportAmount: "too_much" });
    orchestrator.onSurveyRated({ assignment: group.assignment, participantId: a.id, scenarioOrder: 2, supportAmount: "nonsense" });
    assert.equal(modelOf(a.id).receptiveness.beta, before + 2);
    assert.equal(eventsOf(a.id).filter((e) => e.eventType === "survey_rating").length, 1);
  });

  test("after popup help the survey asks the AI questions, and its answer reaches only that member's model", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    const [a, b] = group.members;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    await orchestrator.handlePrivateOfferResponse(input(group, 0, offer.id, "accepted"));
    await submitScenario(group, orchestrator, clock);

    const code = group.session.code;
    const base = {
      scenarioId: "scenario-01",
      collaborationRating: 4,
      sharedAnswerRating: 4,
      autonomyRating: 4,
      satisfactionRating: 4,
      answerConfidence: 4,
      confidenceReason: "We checked every part of the task.",
      doDifferently: "Discuss a little longer first.",
    };
    const post = (member: typeof a, body: Record<string, unknown>) =>
      surveyRoute(
        apiRequest(`/api/sessions/${code}/survey`, {
          method: "POST",
          token: member.token,
          body: { ...base, participantId: member.participant.id, ...body },
        }),
        routeParams({ code })
      );
    const ai = {
      perceivedHelpfulness: 4,
      aiHelpedDiscussion: 4,
      aiHelpedFocus: 3,
      aiHelpedInclusion: 3,
      aiHelpedDisagreement: null,
      aiHelpedThinking: 4,
      overRelianceRating: 2,
      couldAnswerWithoutAi: 3,
    };
    assert.equal((await post(a, ai)).status, 400, "popup help counts as AI use, so the support-amount question is required");
    const before = modelOf(a.participant.id).receptiveness.alpha;
    const saved = await post(a, { ...ai, supportAmount: "appropriate" });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal(modelOf(a.participant.id).receptiveness.alpha, before + 1);
    const ratingEvent = eventsOf(a.participant.id).find((e) => e.eventType === "survey_rating")!;
    assert.equal(ratingEvent.reward, 1);

    assert.equal((await post(b, {})).status, 200);
    assert.equal(eventsOf(b.participant.id).filter((e) => e.eventType === "survey_rating").length, 0);
  });

  test("an unanswered popup expires and counts as a soft 'no'", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    clock.advance(25);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).find((r) => r.id === offer.id)?.status, "expired");
    const event = eventsOf(a.id).find((e) => e.eventKey === `response:${offer.id}`)!;
    assert.equal(event.reward, 0);
    assert.equal(event.weight, 0.5);
  });

  test("Step 2 use holds popups back, popups avoid help already opened there, and asking Step 2 for more marks the popup help as not enough", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    const stepTwo = (type: string) =>
      saveIndividualScaffold({
        sessionId: group.session.id,
        participantId: a.id,
        scenarioOrder: 1,
        scaffoldingType: type,
        aiResponse: `Step 2 ${type}`,
        createdAt: clock.current.toISOString(),
        lastToggledAt: clock.current.toISOString(),
      });
    await stepTwo("guiding_question");
    orchestrator.onStepTwoSelection({ assignment: group.assignment, participantId: a.id });
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).length, 0, "no popup while the member is using Step 2");

    clock.advance(6);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    assert.ok(offer);
    assert.notEqual(offer.supportType, "guiding_question");

    await orchestrator.handlePrivateOfferResponse(input(group, 0, offer.id, "accepted"));
    clock.advance(2);
    await stepTwo("full_answer");
    orchestrator.onStepTwoSelection({ assignment: group.assignment, participantId: a.id });
    const outcome = eventsOf(a.id).find((e) => e.eventKey === `outcome:${offer.id}`)!;
    assert.equal(outcome.reward, 0);
    assert.match(String((outcome.detail as { reason?: string }).reason), /more direct help/);
  });

  test("one member's own 'I'm unsure' is answered privately instead of with a group prompt", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    await say(group, 0, "I'm confused, I don't get this question", clock.current);
    clock.advance(4);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1, "human_activity");
    assert.ok(!(outcome?.decision.action === "offer" && outcome.decision.trigger === "explicit_confusion"));
    assert.ok(interventionRows(group.session.id).every((r) => r.trigger !== "explicit_confusion"));
    const [offer] = adaptiveRows(group.session.id);
    assert.equal(offer.recipientParticipantId, a.id);
    assert.match(offer.reasonExplanation ?? "", /You wrote that you were unsure/);
  });

  test("a required initial idea comes before any popup", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive", features: { initialIdea: "required" } });
    const { clock, orchestrator } = setup();
    const a = group.members[0].participant;
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).length, 0);
    await discussionCoordinator.recordInitialIdea({ sessionId: group.session.id, participantId: a.id, scenarioOrder: 1, text: "My idea" });
    clock.advance(1);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    assert.equal(adaptiveRows(group.session.id).length, 1);
  });

  test("existing conditions never get popups or learner models", async () => {
    const conditions: ResearchCondition[] = ["baseline_private_request", "shared_on_demand", "proactive_group", "dual_adaptive"];
    for (const condition of conditions) {
      const group = await createV2Group({ condition });
      const { clock, orchestrator } = setup();
      await getOrCreateAttempt(group.session.id, 1);
      setOnline(group, [0, 1], clock.current);
      await say(group, 0, "I'm lost, I don't understand this part", clock.current);
      for (let i = 0; i < 4; i++) {
        clock.advance(10);
        await orchestrator.evaluateAttempt(group.session.id, 1);
      }
      const a = group.members[0].participant.id;
      orchestrator.onStepTwoSelection({ assignment: group.assignment, participantId: a });
      orchestrator.onSurveyRated({ assignment: group.assignment, participantId: a, scenarioOrder: 1, supportAmount: "too_much" });
      assert.equal(adaptiveRows(group.session.id).length, 0, condition);
      const models = db.select().from(schema.learnerModels).where(eq(schema.learnerModels.sessionId, group.session.id)).all();
      assert.equal(models.length, 0, condition);
    }
  });

  test("learner exports are anonymous, legacy exports stay unchanged, and the integrity checker passes", async () => {
    const group = await createV2Group({ condition: "proactive_adaptive" });
    const { clock, orchestrator } = setup();
    primeModel(group, 0, EAGER, clock);
    primeModel(group, 1, RELUCTANT, clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(30);
    await orchestrator.evaluateAttempt(group.session.id, 1);
    const [offer] = adaptiveRows(group.session.id);
    const view = await orchestrator.handlePrivateOfferResponse(input(group, 0, offer.id, "accepted"));

    const names = group.members.map((m) => m.participant.displayName);
    for (const type of ["v2_learner_models", "v2_learner_model_events"] as const) {
      const { columns, rows } = buildV2Export(type, [group.session.id]);
      assert.ok(rows.length > 0, type);
      for (const row of rows) {
        assert.equal(row.research_condition, "proactive_adaptive");
        assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), type);
        const text = JSON.stringify(row);
        for (const name of names) assert.ok(!text.includes(`"${name}"`), `${type} contains a nickname`);
        for (const member of group.members) assert.ok(!text.includes(member.participant.id), `${type} contains an internal id`);
      }
    }
    const models = buildV2Export("v2_learner_models", [group.session.id]).rows;
    const accepter = models.find((row) => row.student_id === group.members[0].participant.anonymousId)!;
    assert.equal(accepter.offers_made, 1);
    assert.equal(accepter.offers_accepted, 1);
    const events = buildV2Export("v2_learner_model_events", [group.session.id]).rows;
    assert.ok(events.some((row) => row.event_type === "offer_response" && row.reward === 1));

    const dashboard = buildV2Dashboard(group.session.id)!;
    assert.ok(!dashboard.warnings.some((w) => w.includes("Private interventions exist")));
    assert.equal(dashboard.counts.learnerModels, 2);

    for (const type of Object.keys(EXPORT_BUILDERS) as ExportType[]) {
      const { rows } = await buildGroupExport(type, group.session.id);
      assert.ok(!JSON.stringify(rows).includes(view.content!), `popup help leaked into the legacy ${type} export`);
    }

    const result = spawnSync(
      process.execPath,
      [path.join("scripts", "verify-research-integrity.mjs"), TEST_DATABASE_FILE, "--json"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    const report = JSON.parse(result.stdout);
    assert.deepEqual(
      report.results.filter((r: { severity: string; count: number }) => r.severity === "violation" && r.count > 0),
      []
    );
    assert.equal(result.status, 0, result.stderr);
    for (const check of ["adaptive_support_type", "adaptive_offer_limit", "learner_model_condition", "learner_model_owner", "private_feedback_by_other"]) {
      assert.equal(report.results.find((r: { check: string }) => r.check === check)?.count, 0, check);
    }
  });
});
