import { TEST_DATABASE_FILE } from "../helpers/testDb";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { POST as createGroupRoute } from "@/app/api/admin/sessions/route";
import { GET as exportRoute } from "@/app/api/admin/export/route";
import { db, schema } from "@/lib/db";
import { getOrCreateAttempt } from "@/lib/services/sessions";
import { buildV2Dashboard, buildV2Export, listV2SessionIds, V2_EXPORTS } from "@/lib/utils/exportV2";
import { createLegacyGroup, createV2Group, makeOrchestrator, setOnline, TestClock } from "../helpers/fixtures";

const ADMIN = { "x-admin-password": "research-admin" };

function adminRequest(url: string, init: { method?: string; body?: unknown } = {}) {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { ...ADMIN, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function runIntegrityCheck() {
  return spawnSync(process.execPath, [path.join("scripts", "verify-research-integrity.mjs"), TEST_DATABASE_FILE, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("V2 exports", () => {
  test("every V2 export carries provenance and only anonymous ids", async () => {
    const group = await createV2Group({ condition: "proactive_group" });
    const clock = new TestClock();
    const { orchestrator } = makeOrchestrator(clock);
    await getOrCreateAttempt(group.session.id, 1);
    setOnline(group, [0, 1], clock.current);
    clock.advance(5);
    const outcome = await orchestrator.evaluateAttempt(group.session.id, 1);
    await orchestrator.handlePrivateOfferResponse({
      session: group.session,
      assignment: group.assignment,
      participant: group.members[0].participant,
      interventionId: outcome!.intervention!.id,
      action: "accepted",
    });

    const names = group.members.map((m) => m.participant.displayName);
    for (const type of Object.keys(V2_EXPORTS) as (keyof typeof V2_EXPORTS)[]) {
      const { columns, rows } = buildV2Export(type, [group.session.id]);
      assert.deepEqual(columns.slice(0, 4), [
        "export_schema_version",
        "group",
        "research_condition",
        "intervention_policy_version",
      ]);
      assert.ok(!columns.includes("study_mode"));
      for (const row of rows) {
        assert.equal(row.research_condition, "proactive_group");
        assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), type);
        const text = JSON.stringify(row);
        for (const name of names) assert.ok(!text.includes(`"${name}"`), `${type} contains a nickname`);
      }
    }

    const interventions = buildV2Export("v2_interventions", [group.session.id]).rows;
    assert.equal(interventions.length, 1);
    assert.equal(interventions[0].status, "delivered");
    assert.equal(interventions[0].ai_origin, "mock");
    assert.equal(interventions[0].accepted_by_student_id, group.members[0].participant.anonymousId);
    const evaluations = buildV2Export("v2_evaluations", [group.session.id]).rows;
    assert.ok(evaluations.some((row) => row.decision_action === "offer"));
    const [assignment] = buildV2Export("v2_assignment", [group.session.id]).rows;
    assert.match(String(assignment.data_quality_flags), /mock_ai_output/);
    assert.match(String(assignment.data_quality_flags), /test_policy/);
  });

  test("the all-groups export contains every V2 group and no legacy group", async () => {
    const first = await createV2Group({ condition: "baseline_private_request" });
    const second = await createV2Group({ condition: "dual_adaptive" });
    const legacy = await createLegacyGroup(1);
    const ids = listV2SessionIds();
    assert.ok(ids.includes(first.session.id));
    assert.ok(ids.includes(second.session.id));
    assert.ok(!ids.includes(legacy.session.id));

    const response = await exportRoute(adminRequest("/api/admin/export?type=v2_assignment&scope=all"));
    assert.equal(response.status, 200);
    const csv = await response.text();
    assert.ok(csv.includes(first.session.code));
    assert.ok(csv.includes(second.session.code));
    assert.ok(!csv.includes(legacy.session.code));

    const noTarget = await exportRoute(adminRequest("/api/admin/export?type=v2_assignment"));
    assert.equal(noTarget.status, 400);

    const legacyV2 = await exportRoute(adminRequest(`/api/admin/export?type=v2_interventions&session=${legacy.session.code}`));
    assert.equal(legacyV2.status, 400);
    const legacyOriginal = await exportRoute(adminRequest(`/api/admin/export?type=messages&session=${legacy.session.code}`));
    assert.equal(legacyOriginal.status, 200);
  });

  test("the dashboard warns about demo AI text and the test policy", async () => {
    const group = await createV2Group({ condition: "baseline_private_request" });
    const dashboard = buildV2Dashboard(group.session.id)!;
    assert.ok(dashboard.warnings.some((w) => w.includes("without an OpenAI API key")));
    assert.ok(dashboard.warnings.some((w) => w.includes("test-only policy")));
    assert.equal(dashboard.counts.evaluations, 0);
    const legacy = await createLegacyGroup(1);
    assert.equal(buildV2Dashboard(legacy.session.id), null);
  });
});

describe("Admin group creation", () => {
  test("V2 groups can be created by default and are refused only when V2 is switched off", async () => {
    const saved = { ...process.env };
    try {
      process.env.ADAPTIVE_V2_ENABLED = "false";
      const disabled = await createGroupRoute(
        adminRequest("/api/admin/sessions", { method: "POST", body: { condition: "proactive_group" } })
      );
      assert.equal(disabled.status, 403);

      delete process.env.ADAPTIVE_V2_ENABLED;
      const bad = await createGroupRoute(
        adminRequest("/api/admin/sessions", { method: "POST", body: { condition: "everything_on" } })
      );
      assert.equal(bad.status, 400);

      const retired = await createGroupRoute(
        adminRequest("/api/admin/sessions", { method: "POST", body: { condition: "dual_adaptive" } })
      );
      assert.equal(retired.status, 400);

      const created = await createGroupRoute(
        adminRequest("/api/admin/sessions", { method: "POST", body: { condition: "proactive_group" } })
      );
      assert.equal(created.status, 200);
      const data = await created.json();
      assert.equal(data.condition, "proactive_group");
      assert.equal(data.assignmentMethod, "researcher_selected");
    } finally {
      process.env = saved;
    }
  });

  test("admin routes need the admin password", async () => {
    const response = await createGroupRoute(
      new Request("http://localhost/api/admin/sessions", { method: "POST", body: "{}" })
    );
    assert.equal(response.status, 401);
  });
});

describe("Integrity checker", () => {
  test("passes on data produced by the platform and flags a planted violation", async () => {
    const group = await createV2Group({ condition: "shared_on_demand" });
    await getOrCreateAttempt(group.session.id, 1);
    const clean = runIntegrityCheck();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);

    const attempt = await getOrCreateAttempt(group.session.id, 1);
    db.insert(schema.interventions)
      .values({
        sessionId: group.session.id,
        attemptId: attempt.id,
        scenarioOrder: 1,
        scope: "group",
        initiatedBy: "system",
        trigger: "initial_silence",
        category: "process",
        supportType: "participation_invitation",
        scaffoldLevel: "process",
        status: "suggested",
        offerText: "planted",
        reasonCode: "initial_silence",
        reasonExplanation: "planted",
        researchCondition: "shared_on_demand",
        policyVersion: group.assignment.interventionPolicyVersion,
        promptVersion: "test",
        idempotencyKey: "planted-violation",
      })
      .run();
    const dirty = runIntegrityCheck();
    assert.equal(dirty.status, 1);
    const report = JSON.parse(dirty.stdout);
    const exposure = report.results.find((r: { check: string }) => r.check === "condition_exposure");
    assert.equal(exposure.count, 1);
  });
});
