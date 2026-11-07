import "../helpers/testDb";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST as startRoute } from "@/app/api/sessions/[code]/start/route";
import { GET as scenarioRoute } from "@/app/api/sessions/[code]/scenario/[index]/route";
import { db, schema } from "@/lib/db";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { EligibilityError, eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { joinSession, saveAssessment, setParticipantReady, updateAttemptFields } from "@/lib/services/sessions";
import { markParticipantDroppedOut, recordParticipantConsent, withdrawParticipantConsent } from "@/lib/services/studyV2";
import {
  apiRequest,
  CONSENT_IDS,
  createLegacyGroup,
  createV2Group,
  routeParams,
} from "../helpers/fixtures";

async function rejectsWith(promise: Promise<unknown> | (() => unknown), code: string) {
  await assert.rejects(
    async () => (typeof promise === "function" ? promise() : promise),
    (error: unknown) => error instanceof EligibilityError && error.code === code
  );
}

describe("Per-person consent and the start gate", () => {
  test("consent needs every statement and is recorded only for the member themself", async () => {
    const group = await createV2Group({ condition: "proactive_group", start: false });
    const [a, b] = group.members;
    await rejectsWith(recordParticipantConsent(group.assignment, a.participant.id, ["voluntary"]), "consent_incomplete");
    await recordParticipantConsent(group.assignment, a.participant.id, CONSENT_IDS);
    assert.ok(await eligibilityGuard.getConsent(a.participant.id));
    assert.equal(await eligibilityGuard.getConsent(b.participant.id), null);
  });

  test("no participant data is recorded before that member's consent", async () => {
    const group = await createV2Group({ condition: "baseline_private_request", start: false });
    await rejectsWith(
      eligibilityGuard.assertCanRecordParticipantData(group.assignment, group.members[0].participant.id),
      "consent_required"
    );
  });

  test("the group cannot start until everyone consented and finished the pre-test", async () => {
    const group = await createV2Group({ condition: "shared_on_demand", start: false });
    const [a, b] = group.members;
    await recordParticipantConsent(group.assignment, a.participant.id, CONSENT_IDS);
    await saveAssessment(group.session.id, "pre", {}, {}, 0, 0, a.participant.id);
    await rejectsWith(() => eligibilityGuard.freezeMembership(group.session.id, a.participant.id), "not_ready");

    await recordParticipantConsent(group.assignment, b.participant.id, CONSENT_IDS);
    await rejectsWith(() => eligibilityGuard.freezeMembership(group.session.id, a.participant.id), "not_ready");

    await saveAssessment(group.session.id, "pre", {}, {}, 0, 0, b.participant.id);
    const started = eligibilityGuard.freezeMembership(group.session.id, a.participant.id);
    assert.deepEqual(started.roster.sort(), [a.participant.id, b.participant.id].sort());
    const again = eligibilityGuard.freezeMembership(group.session.id, b.participant.id);
    assert.equal(again.alreadyStarted, true);
  });

  test("scenarios are locked before the start and for anyone outside the frozen roster", async () => {
    const group = await createV2Group({ condition: "proactive_group", start: false });
    const [a] = group.members;
    await rejectsWith(eligibilityGuard.assertScenarioAccess(group.assignment, a.participant.id), "not_started");

    const response = await scenarioRoute(
      apiRequest(`/api/sessions/${group.session.code}/scenario/1?participantId=${a.participant.id}`, { token: a.token }),
      routeParams({ code: group.session.code, index: "1" })
    );
    assert.equal(response.status, 409);
  });

  test("after the start nobody can join and the roster cannot be changed", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    await assert.rejects(joinSession(group.session.code, "Latecomer"), /already started/);
    assert.throws(() =>
      db
        .update(schema.studyAssignments)
        .set({ frozenRosterIds: [group.members[0].participant.id] })
        .where(eq(schema.studyAssignments.sessionId, group.session.id))
        .run()
    );
  });

  test("the research condition and versions are immutable", async () => {
    const group = await createV2Group({ condition: "baseline_private_request", start: false });
    assert.throws(() =>
      db
        .update(schema.studyAssignments)
        .set({ researchCondition: "dual_adaptive" })
        .where(eq(schema.studyAssignments.sessionId, group.session.id))
        .run()
    );
    assert.throws(() =>
      db
        .update(schema.studyAssignments)
        .set({ interventionPolicyVersion: "policy-v2-1" })
        .where(eq(schema.studyAssignments.sessionId, group.session.id))
        .run()
    );
    assert.equal((await conditionManager.getCondition(group.session.id)), "baseline_private_request");
  });

  test("the start route needs the member's own device token", async () => {
    const group = await createV2Group({ condition: "shared_on_demand", start: false });
    const [a, b] = group.members;
    for (const member of group.members) {
      await recordParticipantConsent(group.assignment, member.participant.id, CONSENT_IDS);
      await saveAssessment(group.session.id, "pre", {}, {}, 0, 0, member.participant.id);
    }
    const params = routeParams({ code: group.session.code });
    const noToken = await startRoute(
      apiRequest(`/api/sessions/${group.session.code}/start`, { method: "POST", body: { participantId: a.participant.id } }),
      params
    );
    assert.equal(noToken.status, 401);
    const wrongToken = await startRoute(
      apiRequest(`/api/sessions/${group.session.code}/start`, {
        method: "POST",
        token: b.token,
        body: { participantId: a.participant.id },
      }),
      params
    );
    assert.equal(wrongToken.status, 401);
    const ok = await startRoute(
      apiRequest(`/api/sessions/${group.session.code}/start`, {
        method: "POST",
        token: a.token,
        body: { participantId: a.participant.id },
      }),
      params
    );
    assert.equal(ok.status, 200);
  });
});

describe("Withdrawal and drop-out", () => {
  test("withdrawal is recorded (not deleted) and stops later data capture", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const [a] = group.members;
    await withdrawParticipantConsent(group.assignment, a.participant.id, "no longer interested");
    const consent = await eligibilityGuard.getConsent(a.participant.id);
    assert.ok(consent?.withdrawnAt);
    await rejectsWith(eligibilityGuard.assertCanRecordParticipantData(group.assignment, a.participant.id), "withdrawn");
    await rejectsWith(recordParticipantConsent(group.assignment, a.participant.id, CONSENT_IDS), "withdrawn");
  });

  test("a dropped-out member no longer blocks 'I am good'", async () => {
    const group = await createV2Group({ condition: "shared_on_demand", members: 3 });
    const [a, b, c] = group.members;
    await updateAttemptFields(group.session.id, 1, { finalAnswer: "Our answer" }, null, [], a.participant.id);
    await markParticipantDroppedOut(group.session.id, c.participant.id, "left the room");
    await setParticipantReady(group.session.id, 1, a.participant.id, true);
    const result = await setParticipantReady(group.session.id, 1, b.participant.id, true);
    assert.ok(result.ok && result.value.submitted);
  });
});

describe("Legacy groups are unchanged", () => {
  test("legacy groups have no assignment and no start gate", async () => {
    const legacy = await createLegacyGroup(2);
    assert.equal(await conditionManager.getAssignment(legacy.session.id), null);
    await eligibilityGuard.assertScenarioAccess(null, legacy.members[0].participant.id);
    const response = await scenarioRoute(
      apiRequest(`/api/sessions/${legacy.session.code}/scenario/1?participantId=${legacy.members[0].participant.id}`),
      routeParams({ code: legacy.session.code, index: "1" })
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.v2 ?? null, null);
  });

  test("legacy groups count every member for 'I am good'", async () => {
    const legacy = await createLegacyGroup(2);
    const [a, b] = legacy.members;
    await updateAttemptFields(legacy.session.id, 1, { finalAnswer: "Answer" }, null, [], a.participant.id);
    const first = await setParticipantReady(legacy.session.id, 1, a.participant.id, true);
    assert.ok(first.ok && !first.value.submitted);
    const second = await setParticipantReady(legacy.session.id, 1, b.participant.id, true);
    assert.ok(second.ok && second.value.submitted);
  });
});
