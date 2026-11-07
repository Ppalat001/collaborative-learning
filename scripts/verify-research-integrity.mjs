#!/usr/bin/env node
/**
 * Read-only research-integrity checks for an Adaptive Scaffolding V2 database.
 * Opens the database read-only and never changes it.
 *
 *   node scripts/verify-research-integrity.mjs [path/to/research.db] [--json]
 *
 * Exit code 1 when a violation is found (data that breaks a study rule), 0 when
 * only warnings or nothing was found. A database without V2 tables is reported
 * as legacy-only.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file =
  args.find((a) => !a.startsWith("--")) || process.env.DATABASE_URL?.replace(/^file:/, "") || "data/research.db";
if (!fs.existsSync(file)) {
  console.error(`Database file not found: ${file}`);
  process.exit(1);
}

const policies = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src", "data", "intervention-policies.json"), "utf8")
).versions;
const CONDITIONS = ["baseline_private_request", "shared_on_demand", "proactive_group", "dual_adaptive"];

const db = new Database(file, { readonly: true, fileMustExist: true });
const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
);
const results = [];
const add = (severity, check, message, rows = []) => results.push({ severity, check, message, count: rows.length, sample: rows.slice(0, 5) });
const all = (sql, ...params) => db.prepare(sql).all(...params);

const V2_TABLES = [
  "study_assignments",
  "participant_consents",
  "intervention_evaluations",
  "interventions",
  "intervention_feedback",
  "intervention_state",
  "participant_ai_preferences",
  "ai_sharing_events",
  "scaffold_recommendations",
  "scenario_initial_ideas",
  "group_roles",
  "group_checkpoints",
  "scenario_agreement_reasons",
];
const missing = V2_TABLES.filter((t) => !tables.has(t));

if (missing.length === V2_TABLES.length) {
  add("info", "schema", "No Adaptive Scaffolding V2 tables: legacy-only database.");
} else {
  if (missing.length) add("violation", "schema", `Missing V2 tables: ${missing.join(", ")}`);
  const trigger = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'study_assignments_immutable'")
    .get();
  if (!trigger) add("warning", "immutability_trigger", "Assignment immutability trigger not present yet (created when the app starts).");

  const assignments = all("SELECT * FROM study_assignments");
  const byCondition = CONDITIONS.map((c) => `${assignments.filter((a) => a.research_condition === c).length} ${c}`);
  const legacyCount = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id NOT IN (SELECT session_id FROM study_assignments)").get().n;
  add(
    "info",
    "inventory",
    `Groups: ${legacyCount} legacy, ${assignments.length} V2 (${byCondition.join(", ")}).`
  );

  add(
    "violation",
    "valid_assignment",
    "Assignments with an unknown condition or policy",
    assignments.filter(
      (a) => !CONDITIONS.includes(a.research_condition) || !policies[a.intervention_policy_version]
    ).map((a) => ({ session_id: a.session_id, condition: a.research_condition, policy: a.intervention_policy_version }))
  );

  add(
    "warning",
    "test_policy",
    "V2 groups using the test-only (seconds-scale) intervention policy",
    assignments.filter((a) => policies[a.intervention_policy_version]?.testOnly).map((a) => ({ session_id: a.session_id }))
  );
  add(
    "warning",
    "mock_ai_output",
    "V2 groups with demo AI text (no API key) instead of real AI output",
    all(
      `SELECT i.session_id, 'intervention' AS source, COUNT(*) AS n FROM interventions i
        WHERE i.ai_origin = 'mock' GROUP BY i.session_id
       UNION ALL
       SELECT s.session_id, 'individual_scaffold', COUNT(*) FROM individual_scaffolds s
         JOIN study_assignments a ON a.session_id = s.session_id
        WHERE s.ai_model = 'mock' GROUP BY s.session_id`
    )
  );

  add(
    "violation",
    "v2_rows_for_legacy_groups",
    "V2 records attached to groups without a study assignment",
    all(
      `SELECT session_id, 'interventions' AS tbl FROM interventions WHERE session_id NOT IN (SELECT session_id FROM study_assignments)
       UNION ALL SELECT session_id, 'intervention_evaluations' FROM intervention_evaluations WHERE session_id NOT IN (SELECT session_id FROM study_assignments)
       UNION ALL SELECT session_id, 'participant_consents' FROM participant_consents WHERE session_id NOT IN (SELECT session_id FROM study_assignments)`
    )
  );

  const dataSources = [
    ["discussion_messages", "created_at"],
    ["individual_scaffolds", "created_at"],
    ["edit_events", "created_at"],
    ["surveys", "created_at"],
    ["intervention_feedback", "created_at"],
    ["ai_sharing_events", "created_at"],
    ["scenario_initial_ideas", "created_at"],
    ["scenario_agreement_reasons", "created_at"],
  ].filter(([table]) => tables.has(table));

  add(
    "violation",
    "data_without_consent",
    "Participant data in V2 groups from members without their own consent",
    dataSources.flatMap(([table]) =>
      all(
        `SELECT DISTINCT t.session_id, t.participant_id, '${table}' AS tbl FROM ${table} t
           JOIN study_assignments a ON a.session_id = t.session_id
          WHERE t.participant_id IS NOT NULL
            AND t.participant_id NOT IN (SELECT participant_id FROM participant_consents)`
      )
    )
  );
  add(
    "violation",
    "data_after_withdrawal",
    "Participant data recorded after that member withdrew consent",
    dataSources.flatMap(([table, column]) =>
      all(
        `SELECT t.session_id, t.participant_id, '${table}' AS tbl, t.${column} AS at FROM ${table} t
           JOIN participant_consents c ON c.participant_id = t.participant_id
          WHERE c.withdrawn_at IS NOT NULL AND t.${column} > c.withdrawn_at`
      )
    )
  );
  add(
    "violation",
    "scenario_data_before_start",
    "Chat or private AI support in V2 groups before the group started",
    all(
      `SELECT m.session_id, 'discussion_messages' AS tbl, m.created_at FROM discussion_messages m
         JOIN study_assignments a ON a.session_id = m.session_id
        WHERE a.roster_frozen_at IS NULL OR m.created_at < a.roster_frozen_at
       UNION ALL
       SELECT s.session_id, 'individual_scaffolds', s.created_at FROM individual_scaffolds s
         JOIN study_assignments a ON a.session_id = s.session_id
        WHERE a.roster_frozen_at IS NULL OR s.created_at < a.roster_frozen_at`
    )
  );
  add(
    "violation",
    "late_joiners",
    "Members who joined a V2 group after its roster was frozen",
    all(
      `SELECT p.session_id, p.id AS participant_id, p.joined_at FROM participants p
         JOIN study_assignments a ON a.session_id = p.session_id
        WHERE a.roster_frozen_at IS NOT NULL AND p.joined_at > a.roster_frozen_at`
    )
  );

  add(
    "violation",
    "condition_exposure",
    "Interventions that the group's condition does not allow",
    all(
      `SELECT i.session_id, a.research_condition, i.scope, i.initiated_by, i.id FROM interventions i
         JOIN study_assignments a ON a.session_id = i.session_id
        WHERE a.research_condition = 'baseline_private_request'
           OR (a.research_condition = 'shared_on_demand' AND (i.initiated_by = 'system' OR i.scope = 'individual'))
           OR (a.research_condition = 'proactive_group' AND i.scope = 'individual')`
    )
  );
  add(
    "violation",
    "private_recipient",
    "Private interventions without a recipient from the same group",
    all(
      `SELECT i.session_id, i.id FROM interventions i
        WHERE i.scope = 'individual' AND (i.recipient_participant_id IS NULL OR i.recipient_participant_id NOT IN
          (SELECT id FROM participants p WHERE p.session_id = i.session_id))`
    )
  );
  add(
    "violation",
    "delivered_after_submission",
    "Interventions delivered after the scenario was submitted",
    all(
      `SELECT i.session_id, i.id, i.delivered_at, s.final_answer_at FROM interventions i
         JOIN scenario_attempts s ON s.id = i.attempt_id
        WHERE i.delivered_at IS NOT NULL AND s.final_answer_at IS NOT NULL AND i.delivered_at > s.final_answer_at`
    )
  );
  add(
    "warning",
    "private_without_opt_in",
    "Proactive private offers to members whose opt-in is currently off (they may have opted out later; check research_events)",
    all(
      `SELECT i.session_id, i.id, i.recipient_participant_id FROM interventions i
        WHERE i.scope = 'individual' AND i.initiated_by = 'system'
          AND i.recipient_participant_id NOT IN
            (SELECT participant_id FROM participant_ai_preferences WHERE private_offers_opt_in = 1)`
    )
  );
  add(
    "warning",
    "solo_groups",
    "Started V2 groups with a single-member roster (never a group study)",
    assignments
      .filter((a) => a.roster_frozen_at && JSON.parse(a.frozen_roster_ids ?? "[]").length === 1)
      .map((a) => ({ session_id: a.session_id, condition: a.research_condition }))
  );
  add(
    "warning",
    "template_fallbacks",
    "AI output rejected by the validator and replaced with a template",
    all("SELECT session_id, id FROM interventions WHERE ai_origin = 'template_fallback'")
  );
}
db.close();

const violations = results.filter((r) => r.severity === "violation" && r.count > 0);
const warnings = results.filter((r) => r.severity === "warning" && (r.count > 0 || r.check === "immutability_trigger"));
if (json) {
  console.log(JSON.stringify({ database: file, results, violations: violations.length, warnings: warnings.length }, null, 2));
} else {
  console.log(`Database: ${file}`);
  for (const r of results) {
    if (r.severity === "info") {
      console.log(`  info       ${r.message}`);
      continue;
    }
    const failing = r.count > 0 || r.check === "immutability_trigger";
    const label = !failing ? "ok" : r.severity;
    console.log(`  ${label.padEnd(10)} ${r.check}: ${r.message}${failing && r.count ? ` (${r.count})` : ""}`);
    for (const row of failing ? r.sample : []) console.log(`               ${JSON.stringify(row)}`);
  }
  console.log(`\n${violations.length} violation check(s) failed, ${warnings.length} warning(s).`);
}
process.exit(violations.length > 0 ? 1 : 0);
