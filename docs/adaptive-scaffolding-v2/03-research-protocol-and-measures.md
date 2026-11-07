# 03 — Research protocol and measures

This describes what the code does for research purposes. It is **not** an approved protocol: consent wording, allocation, thresholds and the optional instruments are decisions for the researcher and supervisor (listed at the end).

## Unit of assignment

A **group** (session) gets one condition when it is created, recorded once in `study_assignments` with every version that defines the study (protocol, consent, information sheet, scenario set hash, assessment hash, intervention policy, model configuration, AI mode at creation). The row cannot be changed afterwards (SQLite trigger), and there is no API to change it. Groups created before V2, or while V2 is switched off (`ADAPTIVE_V2_ENABLED=false`), have no assignment and keep the original platform behaviour.

V2 is on by default and every V2 group is handled the same way: there are no separate study modes. Groups that should not be analysed (e.g. your own test runs) are deleted on `/admin` or excluded by group code. Every V2 export carries data-quality flags (`mock_ai_output` when there was no API key, `test_policy`, `not_started`, …) to check before analysis.

Allocation: home-page groups use the configured default condition, `dual_adaptive` unless changed (`configured_default`); the researcher can pick the condition per group on `/admin` (`researcher_selected`); or a server-side random draw from an explicit list (`randomized`). The method is stored per group.

## Conditions (capabilities, not automatic experiments)

| Condition | Private manual help (9 original options) | Shared facilitator on request | Proactive group offers | Proactive private offers (opt-in) | Adaptive level and fading |
|---|---|---|---|---|---|
| `baseline_private_request` | yes | no | no (shadow-logged only) | no | no |
| `shared_on_demand` | yes | yes | no (shadow-logged only) | no | no |
| `proactive_group` | yes | yes | yes | no | no |
| `dual_adaptive` | yes | yes | yes | yes, only for members who switch it on | yes |

Identical in every V2 condition: per-person consent, the start gate (everyone consented and pre-tested, 2–4 members, roster frozen), the neutral opening prompt and checkpoint cards (if enabled for the group), the 10 scenarios, the 500-word answer, unanimous "I am good", per-scenario ratings, post-test and end questionnaire. The optional instruments (role cards, initial individual idea, agreement reason) are off by default and set per group; compared groups must use the same settings.

Because V2 groups have the opening prompt, checkpoints and per-person consent, a **V2 baseline group is not identical to a legacy group**. Compare V2 conditions with each other, not legacy groups with V2 groups. The minimal comparison suggested by the specification is `baseline_private_request` versus `proactive_group`.

## When the AI intervenes (and when it does not)

The `CollaborationMonitor` turns the recorded chat, answer edits and connected members into assessments. Rules are deterministic and versioned (`monitor-rules-v1`); the optional model classifier is off in both shipped policies.

| Trigger | Evidence required (default policy `policy-v2-1`) |
|---|---|
| `initial_silence` | ≥ 2 members connected and no human message for 120 s after they connected |
| `stalled_discussion` | ≥ 2 connected, no message or answer edit for 180 s after earlier activity |
| `explicit_confusion` | a message such as "I'm stuck", "we don't understand"; first person singular = personal, plural = group; ignored if a peer already replied |
| `unresolved_disagreement` | repeated disagreement markers for 150 s without agreement or reasons |
| `possible_participation_imbalance` | ≥ 10 messages over ≥ 300 s with one member writing ≥ 80 %; the offer addresses the group and names nobody |
| `coordination_request` | "how should we split…", "who does what" |

The `InterventionDecisionEngine` then decides `offer` or `no_action` and **always records why**. No-action reason codes: `scenario_submitted`, `consent_incomplete`, `no_difficulty_detected`, `productive_progress` (lively exchange with reasons is left alone), `group_not_present`, `offer_pending`, `max_prompts_reached` (2 per scenario), `cooldown_active` (120 s), `previously_dismissed`, `insufficient_evidence`, `max_private_offers_reached` (1 per member per scenario), and `condition_no_proactive` (shadow log in passive conditions: what would have been offered, never shown). Explicit help-seeking is not suppressed by productive activity. Quiet members are never singled out.

Thresholds in `src/data/intervention-policies.json` are **default starting values, not validated values**. `policy-v2-test-accelerated` uses seconds-scale thresholds for automated tests only.

## How the AI intervenes

- **Offer first, content after a human decision.** A proactive group offer shows only a short neutral text and its reason ("Why this suggestion?"). The AI is called only when a member presses **View/accept**; the support is generated once and delivered to the whole group.
- **Group offer policy (one explicit rule):** the first active member who accepts makes it visible to everyone; **Dismiss** by any member closes it for the group; **Not now** hides it only for that member for 120 s. Every member's action is recorded separately (`intervention_feedback`).
- **Group support types** are process help only (participation invitation, discussion summary, dividing the thinking, disagreement mediation, reasoning prompt, reflection checkpoint, perspective invitation). Output is validated: no full answer, no member names, no singling anyone out; a failed validation is replaced by a fixed template and flagged `template_fallback`.
- **Private offers (`dual_adaptive` only):** default off; a member can switch them on at any time. Triggered only by that member's own expressed confusion, or by pressing **I'm stuck**. Sent only to that member's private socket room and filtered in the database query. Content levels are limited to hint (level 1), guiding question, or explanation (level 2); never a full answer.
- **Adaptive level and fading (`AdaptiveScaffoldingEngine`):** start with a hint; fade to a guiding question after the member worked without AI help in the previous 2 scenarios; recommend level 2 only after level-1 help plus continued confusion or an explicit request for more; never level 3. The recommendation, its evidence and what the member actually chose (including choosing more direct help) are stored.
- **Sharing:** private AI content reaches the group only when its owner presses **Share with group**, previews and edits the text, and confirms. Full-answer responses cannot be shared with this button. Sharing does not prove anyone read it.
- **Human activity is not inflated:** AI items live in their own tables, never in `discussion_messages`, so chat counts and contribution shares stay human-only.
- After a scenario is submitted no AI support is generated; open offers expire.
- If the AI fails, chat and the answer editor keep working; the item is marked `failed` with a reason. Formal groups never receive mock output.

## Measures available (specification section 8)

| Needed for evaluation | Where it is recorded |
|---|---|
| Trigger and no-intervention rates with reason codes | `v2_evaluations` (`trigger`, `decision_action`, `reason_code`, `shadow_only`, `repeat_count` for collapsed identical no-action checks) |
| Time from difficulty to offer, acceptance and later discussion | `v2_evaluations.evaluated_at_utc`, `v2_interventions` (`created_at_utc`, `accepted_at_utc`, `seconds_to_accept`, `delivered_at_utc`), original chat log timestamps |
| Group-visible vs private exposure; who shared | `v2_interventions.scope`/`recipient_student_id`, `v2_feedback` (per member), `v2_sharing` |
| Human dialogue quality (uptake, evidence, disagreement resolution) | **Not automatically coded.** The original chat log export is the source; a manual coding scheme is a next action |
| Autonomy/usefulness ratings, qualitative feedback | Original per-scenario ratings and end questionnaire (unchanged); optional comment on feedback actions |
| Pre/post scores, rubric scores | Original exports (unchanged) |
| Real/mock status, failures, tokens, latency | `v2_interventions` (`ai_origin`, `ai_model`, `failure_reason`, `input_tokens`, `output_tokens`, `ai_latency_ms`), `v2_assignment.ai_mode_at_assignment` |
| Presence vs wall-clock time | Partially: `online_count`/`active_member_count` per evaluation. A per-member active-time measure is **not** exported yet |
| Units of analysis and condition per group | Every V2 export row carries `group`, `research_condition`, `intervention_policy_version`; student rows use the anonymous `student_id` |

New V2 instruments (initial idea, agreement reason, role cards) and the feedback actions are versioned through the protocol and policy versions; they do not alter the original instruments.

## Decisions required from the researcher and supervisor

1. **Consent and information sheet.** The shipped text (`consent-v2-draft-1`) is a draft that participants currently see (with a "Draft wording" note and a contact placeholder): contact details, retention period and the AI-provider wording must be approved, then `study-protocol.json` updated under a new version and its `status` changed so it no longer starts with `DRAFT`.
2. **Withdrawal.** The code stops collecting data after withdrawal and records the time; it does **not** delete data already collected. Whether to delete or keep earlier data must follow the approved protocol (deletion would be a manual researcher action).
3. **Which conditions to compare, and allocation** (fixed per session, researcher-selected, or randomised), with enough groups per condition.
4. **Proactive thresholds** (silence, stall, cooldown, limits). They are default starting values; the first groups should inform them, and any change creates a new policy version.
5. **Group offer rule.** Whether one member may dismiss an offer for the whole group (current rule) or each member decides only for themselves.
6. **Optional instruments.** Initial idea, role cards, agreement reason: each changes the task and needs approval; keep them identical across compared conditions.
7. **Condition disclosure.** Participants see a short description of what the AI may do in their condition (`conditionDisclosure`); confirm this matches the approved protocol.
8. **AI provider and model.** Real-provider behaviour (latency, output quality, validator rejections) has only been tested with mock AI here; confirm the model and data-processing terms.
9. **Test groups.** All V2 groups are stored and exported the same way, so decide which groups count (e.g. delete your own test runs on `/admin`, or list the group codes to exclude).
