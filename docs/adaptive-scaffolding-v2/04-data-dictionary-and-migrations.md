# 04 — Data dictionary and migrations

## Migration

The schema lives in `src/lib/db/schema.ts` and is applied by the existing `drizzle-kit push` that runs before every start (`npm start`, `npm run start:prod`). The V2 change is **additive only**:

- 15 new tables (below): the 13 original V2 tables plus `learner_models` and `learner_model_events` for the adaptive private suggestions (added 2026-11-08; also additive, created empty, used only by `proactive_adaptive` groups).
- 1 new nullable column: `participants.auth_token_hash` (SHA-256 of the member's device token; `NULL` for everyone who joined before V2).
- Indexes and unique constraints listed per table.
- A trigger, `study_assignments_immutable`, created at app start (`src/lib/db/index.ts`): it rejects any `UPDATE` of assignment columns except the one-way roster freeze (`roster_frozen_at`, `frozen_roster_ids`, `started_by`, set once).

No existing table, column or row is changed or deleted. Verified on a copy of the local research database (24 legacy groups) with `npm run db:rehearse`:

```text
unchanged  assessments 69 rows, edit_events 108, final_reflections 30, participants 44,
           research_events 694, rubric_scores 41, sessions 24, surveys 122,
           discussion_messages 177, scaffold_proposals 7, scenario_attempts 58, individual_scaffolds 106
Added tables (15) ... learner_model_events, learner_models ...
Added column: participants.auth_token_hash (NULL for every existing member)
Rehearsal passed: the push is additive and every existing row is unchanged.
```

On a database that already has the 13 V2 tables (Railway after the first V2 deployment), the push adds only the two learner tables; existing V2 rows are unchanged.

The rehearsal makes a consistent backup copy, fingerprints every original column of every row (SHA-256), runs the same non-forced `drizzle-kit push` as production, compares the fingerprints and runs the integrity checker. Run it on a downloaded copy of the Railway database before deploying (see `06-researcher-operating-guide.md`).

### Rollback

- **Preferred:** switch V2 off (`ADAPTIVE_V2_ENABLED=false`; V2 is on when the variable is missing). New groups are legacy again; the extra tables are unused. No schema change is needed.
- **Code rollback to the pre-V2 commit:** tested on a migrated copy. The old schema's `drizzle-kit push` reports data-loss statements (dropping the V2 tables and the column), cannot ask for confirmation without a terminal, **applies nothing**, and exits with code 0 (drizzle-kit 0.31.10), so the old server starts and ignores the V2 tables. **Never** run `drizzle-kit push --force`, or answer "yes" interactively, with the old schema: that deletes V2 data.
- A backup of the database before deployment remains the real safety net.

## New tables

All V2 tables reference `sessions.id` with `ON DELETE CASCADE` (deleting a group deletes its V2 records), and participant references cascade or set null as noted. Times are ISO-8601 UTC strings.

| Table | One row per | Key columns | Constraints |
|---|---|---|---|
| `study_assignments` | V2 group | `research_condition`, `assignment_method`, `created_via`, `study_protocol_version`, `consent_version`, `information_sheet_version`, `scenario_set_version`, `assessment_version`, `intervention_policy_version`, `model_config_version`, `ai_mode_at_assignment`, `min_group_size`, `max_group_size`, `features` (JSON), `assigned_at`, `roster_frozen_at`, `frozen_roster_ids` (JSON), `started_by` | unique `session_id`; immutable (trigger) |
| `participant_consents` | member of a V2 group | `consent_version`, `information_sheet_version`, `confirmed_statements` (JSON ids), `ai_processing_acknowledged`, `consented_at`, `withdrawn_at`, `withdrawal_note`, `dropped_out_at`, `drop_out_note` | unique `participant_id`; withdrawal is recorded, never deleted |
| `scenario_initial_ideas` | member × scenario | `text`, `created_at` | unique (participant, scenario) |
| `group_roles` | member × scenario | `role`, `matches_rotation` | unique (participant, scenario) |
| `group_checkpoints` | checkpoint raised | `participant_id` (set null), `kind`, `created_at` | index (session, scenario) |
| `scenario_agreement_reasons` | "I am good" reason | `reason`, `created_at` | index (session, scenario) |
| `intervention_evaluations` | monitor + decision run (identical repeated no-action runs collapsed) | `evaluation_source`, `research_condition`, `policy_version`, `trigger`, `assessment_source`, `evidence_message_ids`, `evidence_summary`, `confidence`, `progress_state`, `assessments` (JSON), `decision_action`, `decision_scope`, `target_participant_id`, `support_type`, `recommended_level`, `reason_code`, `reason_explanation`, `activity_watermark`, `online_count`, `active_member_count`, `classifier_model`, `shadow_only`, `repeat_count`, `evaluated_at`, `last_repeated_at` | index (attempt, evaluated_at) |
| `interventions` | offer or request | `evaluation_id`, `scope` (group/individual), `recipient_participant_id`, `initiated_by` (system/participant), `requested_by_participant_id`, `trigger`, `category` (process/content), `support_type`, `scaffold_level`, `status`, `offer_text`, `reason_code`, `reason_explanation`, `content`, `research_condition`, `policy_version`, `prompt_version`, `ai_model`, `ai_origin` (real/mock/template_fallback), `ai_latency_ms`, `input_tokens`, `output_tokens`, `failure_reason`, `accepted_by_participant_id`, `idempotency_key`, `created_at`, `accepted_at`, `delivered_at`, `resolved_at`, `expires_at` | unique `idempotency_key`; indexes (attempt, created_at), (recipient) |
| `intervention_feedback` | member action on an intervention | `action` (viewed/accepted/dismissed/deferred/why_viewed/shared), `comment`, `created_at` | index (intervention) |
| `intervention_state` | scenario attempt | `last_evaluated_at`, `last_evaluation_id`, `last_evaluation_signature`, `last_proactive_at`, `proactive_group_count`, `proactive_private_count` | unique `attempt_id` |
| `participant_ai_preferences` | member | `private_offers_opt_in`, `updated_at` | unique `participant_id` |
| `ai_sharing_events` | explicit share | `source_type` (individual_scaffold/intervention), `source_id`, `source_support_type`, `shared_text` | index (session, scenario) |
| `scaffold_recommendations` | adaptive recommendation | `engine_version` (`adaptive-v1` = Step 2 rule engine, `adaptive-bandit-v1` = popup decision), `recommended_level`, `recommended_support_type`, `fading_applied`, `evidence` (JSON; for popups: seed, pause, pause percentile, sampled values, need, score, threshold, allowed help, posterior summary), `rationale`, `chosen_support_type`, `chosen_level`, `overridden`, `resolved_at`, `intervention_id` (the popup) | index (participant, scenario) |
| `learner_models` | member of a `proactive_adaptive` group | `model_version`, `policy_version`, `pretest_fraction`, `state` (JSON: pace posterior `mu/kappa/a/b/observations`, `independence`, `receptiveness`, `arms.{guiding_question,hint,explanation}` as Beta `alpha/beta`, `pace_cursor`, `updates`), `created_at`, `updated_at` | unique `participant_id`; created on first use from the policy priors |
| `learner_model_events` | learner model update | `scenario_order`, `event_type` (model_created, pace_gaps, offer_response, help_outcome, scenario_outcome, survey_rating), `event_key`, `intervention_id` (set null), `reward` (1/0/null), `weight`, `detail` (JSON), `state_before`, `state_after`, `created_at` | unique (participant, event_key) so each update is applied once; index (participant, created_at) |

Intervention statuses: `suggested` → `accepted` → `delivered` or `failed`; `suggested` → `dismissed`, `deferred` (private only) or `expired` (after 600 s in the default policy, or when the scenario is submitted). Transitions are atomic, so concurrent accepts generate content once.

Adaptive popups are `interventions` rows with `scope = individual`, `initiated_by = system`, `trigger = adaptive_need`, `reason_code = adaptive_private`, `category = content`, `support_type` guiding_question / hint / explanation, `evaluation_id` empty (the decision is in `scaffold_recommendations`). They expire after 120 s (`policy-v2-2`); **Not now** sets `status = deferred` with `resolved_at` and no expiry, so the popup does not come back and is not expired at submission. Popup help is **not** written to `individual_scaffolds`, so the original `ai_support` export keeps meaning "Step 2 choices only".

Existing tables used by V2 without schema changes: `research_events` (lifecycle events such as `v2_scenarios_started`, consent, opt-in changes), `discussion_messages`, `individual_scaffolds`, `scenario_attempts` (readiness uses the frozen roster for V2 groups).

## Exports

### Original exports (unchanged)

The 8 original CSVs (`scenarios`, `messages`, `ai_support`, `contributions`, `ratings`, `assessments`, `reflections`, `rubric`) are produced by the unmodified `src/lib/utils/export.ts`. `tests/integration/legacy-exports.test.ts` compares their column lists with `tests/fixtures/legacy-export-columns.json` (recorded from the unchanged code) for legacy and V2 groups. They work for every group, legacy or V2, one group at a time.

### V2 exports (`export_schema_version = v2-export-1`)

`GET /api/admin/export?type=<v2 type>&session=GROUP-XXXX` (one V2 group; legacy groups are refused) or `&scope=all` (every V2 group in one file, oldest first; legacy groups never included). Students appear only as the anonymous `student_id`; nicknames are not in V2 exports.

Every V2 row starts with the provenance columns `export_schema_version, group, research_condition, intervention_policy_version`.

| Type | One row per | Columns after provenance |
|---|---|---|
| `v2_assignment` | group | assignment_method, created_via, study_protocol_version, consent_version, information_sheet_version, scenario_set_version, assessment_version, model_config_version, ai_mode_at_assignment, min_group_size, max_group_size, feature_opening_prompt, feature_checkpoints, feature_roles, feature_initial_idea, feature_agreement_reason, assigned_at_utc, started_at_utc, roster_size, members_joined, scenarios_finished, completed_at_utc, ai_origins_used, data_quality_flags |
| `v2_consents` | member | student_id, joined_at_utc, consented, consent_version, information_sheet_version, consented_at_utc, ai_processing_acknowledged, withdrawn_at_utc, dropped_out_at_utc, in_frozen_roster |
| `v2_evaluations` | logged evaluation | scenario_number, evaluation_id, evaluated_at_utc, last_repeated_at_utc, repeat_count, evaluation_source, trigger, all_triggers, assessment_source, evidence_summary, evidence_message_count, confidence, progress_state, decision_action, decision_scope, target_student_id, support_type, recommended_level, reason_code, reason_explanation, shadow_only, online_count, active_member_count, classifier_model |
| `v2_interventions` | intervention | scenario_number, intervention_id, evaluation_id, scope, recipient_student_id, initiated_by, requested_by_student_id, trigger, category, support_type, scaffold_level, status, reason_code, created_at_utc, accepted_at_utc, accepted_by_student_id, delivered_at_utc, resolved_at_utc, expires_at_utc, seconds_to_accept, ai_origin, ai_model, prompt_version, ai_latency_ms, input_tokens, output_tokens, failure_reason, offer_text, content, viewed_count, accepted_count, dismissed_count, deferred_count, why_viewed_count, shared_count |
| `v2_feedback` | member action | scenario_number, intervention_id, intervention_scope, intervention_initiated_by, support_type, student_id, action, comment, at_utc |
| `v2_sharing` | explicit share | scenario_number, student_id, source_type, source_id, source_support_type, shared_text, shared_at_utc |
| `v2_recommendations` | recommendation | scenario_number, student_id, engine_version, recommended_level, recommended_support_type, fading_applied, rationale, chosen_support_type, chosen_level, chose_more_direct_than_recommended, intervention_id, created_at_utc, resolved_at_utc, evidence_json |
| `v2_learner_models` | member with a learner model | student_id, model_version, policy_version, pretest_fraction, pace_median_seconds, pace_observations, independence_mean, receptiveness_mean, guiding_question_effect_mean, hint_effect_mean, explanation_effect_mean, updates, offers_made, offers_accepted, offers_no_thanks, offers_not_now, offers_expired, created_at_utc, updated_at_utc, state_json |
| `v2_learner_model_events` | learner model update | scenario_number, student_id, event_type, event_key, intervention_id, reward, weight, detail_json, independence_mean_after, receptiveness_mean_after, pace_median_seconds_after, guiding_question_effect_mean_after, hint_effect_mean_after, explanation_effect_mean_after, at_utc, state_before_json, state_after_json |
| `v2_initial_ideas` | member × scenario | scenario_number, student_id, initial_idea, written_at_utc, first_private_ai_at_utc, written_before_private_ai |
| `v2_roles` | member × scenario | scenario_number, student_id, role, matches_suggested_rotation, chosen_at_utc |
| `v2_checkpoints` | checkpoint | scenario_number, raised_by_student_id, kind, raised_at_utc |
| `v2_agreement_reasons` | reason | scenario_number, student_id, reason, at_utc |
| `v2_ai_usage` | group × scenario it opened | scenario_number, human_chat_messages, group_ai_requests, group_ai_request_replies, group_ai_proactive_offers, group_ai_proactive_accepted, group_ai_proactive_replies, group_ai_proactive_expired, group_ai_proactive_closed_by_members, step2_private_ai_replies, step2_real_ai, step2_demo_text, private_popups_offered, private_popups_accepted, private_popups_no_thanks, private_popups_not_now, private_popups_expired, shared_excerpts, ai_replies_real, ai_replies_demo_text, ai_replies_template_fallback, progress_feedback_yes, progress_feedback_partly, progress_feedback_no, progress_feedback_not_needed, progress_feedback_skipped, outcome_resolved_yes, outcome_resolved_partly, outcome_resolved_no, outcome_resolved_unknown, input_tokens, output_tokens, failed_generations, data_quality_flags, group_warnings |

Notes for analysis:

- `repeat_count` > 1 means identical consecutive no-action evaluations were collapsed into one row; weight by it when computing evaluation rates.
- `shadow_only = true` rows come from passive conditions: what the system would have offered, never shown to students.
- `seconds_to_accept` is from offer creation to the first acceptance.
- `content` of private interventions is exported for the researcher; it was visible only to the recipient.
- `v2_ai_usage` counts each kind on its own: human chat messages never include AI items, an offer is not a reply, and an unknown outcome stays unknown. Step 2 replies carry no token counts. Sum the scenario rows for group totals; `data_quality_flags` and `group_warnings` describe the whole group and repeat on every row.

### `data_quality_flags` (in `v2_assignment`, `v2_ai_usage` and the dashboard API)

| Flag | Meaning |
|---|---|
| `mock_ai_at_assignment` | no real AI provider when the group was created |
| `mock_ai_output` / `template_fallback_output` | at least one intervention used mock text, or a validator-rejected output was replaced by a template |
| `test_policy` | a test-only intervention policy was used |
| `not_started` | the group never passed the start gate |
| `solo_member` | the frozen roster has one member (not possible with the current 2–4 group size) |
| `withdrawal_recorded` / `dropout_recorded` | at least one member withdrew or was recorded as having left |

## Integrity checker

`npm run db:verify [path]` (read-only) checks: valid assignments (known condition and policy); the immutability trigger; V2 rows attached to legacy groups; participant data without that member's consent; data after withdrawal; chat or private AI before the start; late joiners; interventions the condition does not allow (any in baseline, proactive or private in `shared_on_demand`, private in `proactive_group`, private other than adaptive popups in `proactive_adaptive`, adaptive popups in any other condition); responses to a private item from anyone but its recipient; adaptive popups of a kind other than hint / guiding question / explanation; more adaptive popups per member and scenario than the group's policy allows; learner models in groups without adaptive suggestions, or belonging to a member of another group; private items without a recipient in the group; deliveries after submission. Warnings: groups on the test-only policy, demo AI text (no API key), private offers (other than adaptive popups, which need no opt-in) to members whose opt-in is now off, solo groups, template fallbacks. Exit code 1 on any violation.
