# 03: Developer guide (V2.3 learning-aware extension)

V2.3 is active for a group only when its stored policy has a `learningAware` block (`policy-v2-3`, `policy-v2-3-test-accelerated`). Every other group runs exactly the V2 code paths and writes no V2.3 rows. The integrity checker enforces this (`v2_3_rows_for_older_policies`).

## 1. Pipeline (one evaluation)

`InterventionOrchestrator.runEvaluation` is called by the existing scheduler (`ADAPTIVE_V2_SCHEDULER_MS`, default 5 s) and by debounced chat, edit and checkpoint events. For a learning-aware policy it runs these steps:

1. `CollaborationMonitor.evaluateDue`: activity triggers. Pure; same as V2.
2. `groupStateMemory.estimate` → `GroupStateEstimator`: stage, state, heuristic confidence, evidence, counter-evidence and uncertainty reasons. Pure.
3. `refineGroupState`: the optional classifier, only for ambiguous estimates, only with real AI configured, and never in passive (shadow) conditions.
4. `estimatorAssessments`: the estimate becomes assessments for the decision engine.
5. `InterventionDecisionEngine.decide`: the V2 rules plus the context gate (section 3).
6. `logDecision` → `intervention_evaluations`. Identical repeated no-action runs are collapsed, as in V2.
7. The estimate → `group_state_estimates`, linked by `evaluation_id`. Repeats are collapsed by `context_signature`.
8. If a group offer is made: create it, broadcast to the group room, and record `server_created` exposures for every active member.
9. `proactive_adaptive` only: `evaluateLearningAwarePrivate` for each active member (section 4) → `private_decision_traces`. A private offer, if any, is emitted to `participant:<id>` only.
10. Outcomes of delivered offers whose window has closed are evaluated (section 6).

In the passive conditions (`baseline_private_request`, `shared_on_demand`), steps 1–7 run as a shadow log (deterministic estimator, no classifier) and no offer is ever visible.

## 2. GroupStateEstimator

**Inputs:**

- human group chat
- shared-answer edit summaries
- checkpoints
- the public snapshot (presence, timings)

It never reads private Step 2 help or private popups.

**Stages:**

- `task_understanding`
- `idea_generation`
- `evidence_comparison`
- `answer_synthesis`
- `consensus_review`
- `uncertain`

**States:**

- `productive`
- `constructive_disagreement`
- `possible_confusion`
- `possible_stall`
- `coordination_need`
- `unproductive_conflict`
- `uncertain`

**Rules (configured in `learningAware.estimator`):**

- Progress is new content in the last `progressWindowSeconds`:
  - a reasoned message whose content tokens are new compared with earlier messages
  - or a substantive answer revision
  - Volume alone is not progress: many short messages without new content stay `uncertain`.
- Disagreement that keeps adding new reasons is `constructive_disagreement`, not failure.
- `unproductive_conflict` needs at least `minRepeatedMessagesForLoop` repeated statements (token similarity ≥ `repetitionSimilarity`) over at least `loopMinSeconds`.
- `possible_stall` needs no activity for the policy's `stallSeconds` (or `initialSilenceSeconds` before the first message). A recent "let me think", "I'm working on it" or "I got it" lowers confidence below the gate.
- Evidence older than `staleEvidenceSeconds` halves the confidence.
- A group that is not present, or has submitted, is never estimated as needing help.

`confidence` is a heuristic in [0, 1], not a calibrated probability.

**Optional classifier (`learningAware.classifier`; off in `policy-v2-3`):**

- consulted only when the estimate is ambiguous
- rate-limited by `minSecondsBetweenCalls`
- timeout `timeoutMs`
- speakers are pseudonymized as "Member A/B/C"
- messages that look like prompt injection are replaced by `[withheld]`
- the output must pass `validateClassifierOutput` and cite existing message IDs
- results below `minConfidence` are rejected
- the resulting confidence is `min(classifier, deterministic)`
- failures keep the deterministic estimate, with note `classifier_unavailable` or `rejected`

## 3. Context gate (group offers)

These rules apply only when `ctx.groupState` is set and the policy is learning-aware.

| Reason code | When |
|---|---|
| `context_productive` | state `productive` (also when no trigger fired) |
| `context_constructive_disagreement` | state `constructive_disagreement` |
| `context_gate_uncertain` | state `uncertain` or confidence < `contextGate.minConfidenceToAct` |
| `context_state_mismatch` | the inferred trigger's required state is not the estimated one |
| `awaiting_outcome` | a group prompt was delivered less than `outcome.windowSeconds` ago |
| `previous_prompt_ineffective` | an earlier group prompt for this trigger in this scenario had a `usable` outcome with difficulty resolved "no" |

- Gated triggers (inferred): `initial_silence`, `stalled_discussion`, `unresolved_disagreement`, `possible_participation_imbalance`.
- Never gated (explicit requests): `explicit_confusion`, `coordination_request`.
- All V2 eligibility rules (consent, presence, caps, cooldowns, condition) still apply first.

## 4. Private decision (`LearningAwarePrivateDecision`)

The decision is pure and seeded. The seed is `${participantId}|${scenarioOrder}|${episodeStart}|${state.updates}`, so the same evidence gives the same draw. The offer idempotency key `adaptive:${attemptId}:${seed}` prevents re-offering an unchanged draw; that case is logged as `already_offered_for_this_evidence`.

The checks run in order; the first that matches produces a `wait` with that reason:

1. V2 limits:
   - `scenario_submitted`
   - `not_online`
   - `offer_pending`
   - `max_offers_reached`
   - `offer_cooldown`
   - `scenario_just_started`
   - `using_step_two`
2. V2.3 gates:
   - `member_preference_stop`
   - `reassess_no_more_proactive`
   - `member_reports_progress`
   - `need_not_corroborated` (with `requireCorroboratedNeed`, the member's own unanswered "I'm unsure", or a group difficulty state at or above the gate confidence, is required)
   - `faded_after_independent_work` (tier `no_offer` without own confusion)
   - `recently_active`
   - `no_suitable_help_left`
3. The score:
   - need = 1 − (1 − pause·struggle)(1 − confusion)(1 − groupDifficulty·struggle)
   - score = need × receptiveness
   - `below_threshold` if the score is below `offerThreshold`

Otherwise the decision is an offer of the arm with the highest Thompson sample. Arms are limited to level 1 (guiding question, hint) unless the tier is `moderate`, which also allows an explanation (level 2).

Traces are collapsed by `action|reasonCode|tier|supportType` and carry the full evidence (seed, samples, need, score, posterior summary, group state). The `v2_3_private_decisions` export replaces the internal ID at the start of the seed with the anonymous student ID.

## 5. Scaffolding state (`ScaffoldingState`)

| Event | Transition | Evidence required |
|---|---|---|
| `fading` at scenario start (`fade_start:<n>`) | → `no_offer` | `fadeAfterIndependentScenarios` consecutive independent scenarios just before |
| `fading` | → `no_offer` | the member answered "I didn't need it" |
| `escalation` | `minimal` / `no_offer` → `moderate` | after level-1 help: the member answered No or Partly, or a usable outcome shows the difficulty persisted |
| `reassess` | → `reassess` | after level-2 help: the member answered No, or a usable outcome shows "no" |
| `preference_stop` | (unchanged tier) | "Don't suggest again in this scenario" |

- A Step 2 request is never escalation evidence.
- Without reliable evidence the tier does not change.
- Each new scenario re-derives its initial tier, so fading is not permanent.
- Events are idempotent through `(participant_id, event_key)`.

## 6. Outcome evaluation (`OutcomeEvaluator`)

The evaluator runs once per delivered proactive offer and subject: the recipient for private offers, `"group"` for shared ones. It runs after `outcome.windowSeconds`, or earlier if the scenario is submitted (the window is then truncated). Its fields are independent of each other:

- `activity_resumed`: own (or group) message, or a substantive edit of at least 10 characters. `null` if the window was truncated without activity.
- `difficulty_resolved`:
  - `yes` / `partly` / `no` / `unknown`
  - The members' own one-click answers take precedence (`resolution_source = feedback`); otherwise an observable proxy per trigger (`observation`).
  - Example proxies: reasoning after own confusion; two members talking again after a stall; agreement after disagreement.
- `understanding_evidence`: always `not_assessed`.
- `was_visible`: whether any `SEEN_KINDS` exposure exists for the subject.
- `confounds`: Step 2 help, other interventions in `confoundWindowSeconds`, or a truncated window.
- `validity`:
  - `insufficient_evidence` (not seen, or nothing observable)
  - `confounded`
  - `usable`

Group outcomes never update a learner model; they feed `previous_prompt_ineffective`. A private outcome is passed to the reward policy (section 7). Feedback that arrives later amends the outcome (`amended_at`) without double-counting.

## 7. Reward policy reward-v2-3 (`BanditRewardPolicy`)

`observe(B, success, w)` adds `w` to α on success and to β on failure. `w` stands for the policy's `learningAware.rewards` weights.

| Signal | Channel(s) | Update |
|---|---|---|
| accepted | receptiveness | observe(success, `accepted`=1) |
| dismissed | receptiveness | observe(failure, `dismissed`=1) |
| deferred ("Not now") | receptiveness (+ pace) | observe(failure, `deferred`=0.25); the pause is added as a normal gap |
| offer expired (seen or unseen) | none | missing data, no update |
| feedback Yes | arm, independence | arm observe(success, 1); independence observe(failure, `helpUseful`=0.5) |
| feedback Partly | arm | α += 0.5 and β += 0.5 (documented fractional approximation) |
| feedback No | arm | observe(failure, 1) |
| feedback "I didn't need it" | independence | observe(success, `notNeeded`=0.5); arm unchanged |
| feedback Skip | none | missing |
| observed outcome, not seen | none | missing |
| observed outcome, activity known and validity not insufficient | activity (engagement only) | observe(activity, `activityResponse`=1) |
| observed outcome, `usable` and resolved yes / no / partly | arm | observe at `observedOutcome`=0.5 (partly: +0.25 / +0.25) |
| scenario contributed without AI help | independence | observe(success, `independentScenario`=1) |
| higher Step 2 support used | none | logged as observed higher support usage |
| own "I'm unsure" (once per scenario) | independence | observe(failure, `selfReportedDifficulty`=0.5) |
| survey support amount | receptiveness | too much: failure ×2; too little: success ×2; about right: success ×1 |

Every signal is logged in `learner_model_events` with `detail.rewardVersion`, `channels`, `updateApplied`, `evidenceQuality` (`explicit` / `observed` / `missing` / `not_applicable`) and `note`. Unchanged signals are logged with `updateApplied: false` and reward null. Older policies keep the V2 rules in `adaptive/rewards.ts`.

## 8. API, sockets and UI

All participant routes authenticate with `authorizeParticipant(request, code, participantId, { requireScenarioAccess: true })`. That check covers four things:

- the device token must match the claimed member (401)
- the member must belong to this group (403)
- consent, withdrawal and assignment are checked server-side
- the frozen roster is checked server-side

A client-supplied member ID is never trusted on its own.

| Route | Body | Result / errors |
|---|---|---|
| `POST /api/sessions/[code]/interventions/[id]/exposure` | `{ participantId, kind, clientAt? }`; kind ∈ `socket_delivered`, `client_displayed_in_viewport`, `user_opened`, `indicator_dismissed` | `{ recorded, duplicate, clientClockRejected }`. Errors: 400 unknown kind, or `indicator_dismissed` on a private offer; 404 offer not visible to this member; 409 policy not learning-aware, offer closed, or scenario submitted; 429 more than `maxEventsPerMinute` |
| `POST /api/sessions/[code]/interventions/[id]/progress` | `{ participantId, response }`; response ∈ `yes`, `partly`, `no`, `not_needed`, `skip` | `{ response, duplicate }` (first answer wins). Errors: 400 invalid; 404 not the recipient; 409 not delivered proactive support, or older policy |
| `POST /api/sessions/[code]/interventions` | `{ kind: "stop_proactive_for_scenario", scenarioOrder, participantId, interventionId? }` | `{ stopped: true }`; dismisses the open popup. Error: 409 for older policies or conditions without popups |
| `GET /api/sessions/[code]/interventions` | – | adds `learningAware` (fields below) |
| `GET/POST /api/admin/v2-3/review` | admin | `mode=sample` (blind, pseudonymized windows), `mode=agreement`, or POST a label |
| `GET/POST /api/admin/v2-3/open-rubric` | admin | 404 unless `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC=true` |
| `GET /api/admin/export?type=v2_3_*` | admin | the V2.3 exports (section 10) |
| `GET /api/admin/interventions?session=` | admin | adds `learningAware` dashboard data (null for groups without V2.3 data) |

The `learningAware` block returned by `GET /api/sessions/[code]/interventions` contains:

- `enabled`
- `dismissal`
- `feedbackEnabled`
- `feedbackDelaySeconds`
- `proactiveStopped`
- `progressFeedback` (this member's answers only)

**Sockets:** no new events. Shared offers use the existing `intervention:offered`, `intervention:state` and `intervention:delivered` events to the group room. Private offers go to `participant:<id>` only. Group payloads carry no per-member feedback. `intervention:feedback` to the group carries anonymous counts only; a member's own action goes to that member only.

**UI:**

- `DiscussionChat` (since `policy-unified-1`, for every V2 group; it replaced `GroupSuggestionIndicator` and `GroupAIFacilitatorPanel`):
  - shared offers and group AI replies are items in the Step 1 chat, built by `buildGroupTimeline` (see [`HOW_THE_FINAL_SYSTEM_WORKS.md`](../../HOW_THE_FINAL_SYSTEM_WORKS.md))
  - reports `client_displayed_in_viewport` via `IntersectionObserver` on the chat list, only when the tab is visible
  - under per-member dismissal the offer's "Hide for me" hides it for this member only; a hidden offer shows "You hid an AI group suggestion. The others can still open it."
  - no modal, sound or flashing
- `PrivateSuggestionPopup`:
  - reports display and open events
  - offers "Don't suggest again in this scenario"
- `ProgressFeedbackPrompt`:
  - "Did this help you make progress? (optional, one click)": Yes / Partly / No / I didn't need it / Skip
  - shown `feedbackDelaySeconds` after delivery, once per member and suggestion
  - `role="group"` with a label
- `useInterventions` reports `socket_delivered` on receipt and keeps the member's own state.

## 9. Schema (additive)

There are 8 new tables. No existing table or column changes. All tables reference `sessions.id` with `ON DELETE CASCADE`. Times are ISO-8601 UTC.

| Table | Unique / index | Purpose |
|---|---|---|
| `group_state_estimates` | index (attempt, estimated_at) | estimate behind an evaluation; `evaluation_id` (set null), `context_signature`, `repeat_count` |
| `private_decision_traces` | index (participant, scenario) | every private decision incl. waits; links to estimate and intervention |
| `scaffolding_state_events` | unique (participant, event_key) | escalation / fading / reassess / preference_stop |
| `offer_exposures` | unique (intervention, participant, kind) | per-member verifiable exposure |
| `intervention_outcome_evaluations` | unique (intervention, subject_key) | observed outcome, validity, `update_applied` |
| `intervention_progress_feedback` | unique (intervention, participant) | one-click answers |
| `open_answer_rubric_scores` | unique (assessment, question, rater) | optional 0–4 rubric, separate from the MCQ score |
| `human_review_labels` | unique (target_type, target_id, rater) | researcher labels |

The migration is the existing `drizzle-kit push` at start-up. `npm run db:rehearse` verifies on a copy that it is additive (see `06-test-and-release-report.md`).

## 10. Exports (`export_schema_version = v2-3-export-1`)

Every row starts with `export_schema_version, group, research_condition, intervention_policy_version`. Students appear only as the anonymous `student_id`; there are no nicknames, tokens or internal IDs. The 8 original and 13 V2 exports are unchanged.

| Type | One row per |
|---|---|
| `v2_3_group_states` | estimate (with the decision it fed) |
| `v2_3_private_decisions` | private decision trace |
| `v2_3_scaffolding_events` | scaffolding event |
| `v2_3_exposures` | member × offer × exposure kind (`counts_as_seen`) |
| `v2_3_outcomes` | outcome evaluation |
| `v2_3_progress_feedback` | one-click answer |
| `v2_3_offer_funnel` | proactive offer × member who could receive it: proposed, delivered to device, seen, own response, accepted by anyone, content delivered, effective proxy, progress feedback, human-rated count |
| `v2_3_review_labels` | review label, next to the system's decision and state |
| `v2_3_open_rubric` | rubric score |

**Missing-data semantics:**

- An empty cell or `unknown` means not observed. It is never a negative outcome.
- `seen` means displayed on screen, not read.
- `effective_proxy` is associational.

## 11. Policy `policy-v2-3` (full configuration)

`current` in `src/data/intervention-policies.json` is `policy-v2-3`. The group thresholds, caps and private safety limits are carried forward unchanged from `policy-v2-2`. What is new is the `learningAware` block and `adaptivePrivate.modelVersion = adaptive-bandit-v2-3`.

```json
{
  "status": "policy-v2-2 group thresholds and private safety caps, plus the V2.3 learning-aware extension: group-state context gate, per-member offer exposure, outcome-aware rewards that treat missing evidence as missing, and contingent escalation/fading. Starting values, NOT validated scientific thresholds",
  "testOnly": false,
  "minActiveMembersForGroupTriggers": 2,
  "initialSilenceSeconds": 120,
  "stallSeconds": 180,
  "productiveWindowSeconds": 90,
  "recentWindowSeconds": 240,
  "disagreementPersistSeconds": 150,
  "cooldownSeconds": 120,
  "maxProactiveGroupPerScenario": 2,
  "maxProactivePrivatePerParticipantPerScenario": 1,
  "imbalanceMinMessages": 10,
  "imbalanceMinActiveSeconds": 300,
  "imbalanceTopShare": 0.8,
  "evaluationDebounceMs": 5000,
  "deferSeconds": 120,
  "offerExpirySeconds": 600,
  "maxManualGroupRequestsPerScenario": 6,
  "manualRequestCooldownSeconds": 30,
  "maxPersonalRequestsPerScenario": 3,
  "fadingLookbackScenarios": 2,
  "shadowMonitoringInPassiveConditions": true,
  "classifier": { "enabled": false, "timeoutMs": 8000, "minConfidence": 0.6 },
  "facilitator": {
    "maxTranscriptMessages": 40, "maxTranscriptChars": 6000, "maxAnswerChars": 3500,
    "maxOutputTokens": 350, "maxOutputChars": 1200, "timeoutMs": 25000
  },
  "adaptivePrivate": {
    "modelVersion": "adaptive-bandit-v2-3",
    "maxOffersPerScenario": 2,
    "minSecondsBetweenOffers": 90,
    "minSecondsIntoScenario": 45,
    "minPauseSeconds": 30,
    "stepTwoCooldownSeconds": 120,
    "offerExpirySeconds": 120,
    "outcomeWindowSeconds": 180,
    "burstMergeSeconds": 10,
    "maxGapSeconds": 900,
    "offerThreshold": 0.25,
    "confusionEvidence": 0.8,
    "stallEvidence": 0.3,
    "priors": {
      "paceMedianSeconds": 60, "paceLogSd": 0.8, "pacePseudoObservations": 2, "independenceStrength": 4,
      "receptiveness": [2, 1],
      "arms": { "guiding_question": [2, 1], "hint": [1.8, 1], "explanation": [1.2, 1] }
    },
    "weights": {
      "accepted": 1, "dismissed": 1, "deferred": 0.5, "expired": 0.5, "helpSucceeded": 1, "helpFailed": 1,
      "independentScenario": 1, "directHelpScenario": 1, "surveyTooMuch": 2, "surveyTooLittle": 2, "surveyAboutRight": 1
    }
  },
  "learningAware": {
    "engineVersion": "learning-aware-engine-v2-3",
    "estimatorVersion": "group-state-estimator-v1",
    "evaluatorVersion": "outcome-evaluator-v1",
    "scaffoldingVersion": "scaffolding-state-v1",
    "contextGate": { "minConfidenceToAct": 0.55 },
    "estimator": {
      "progressWindowSeconds": 180, "repetitionSimilarity": 0.6, "minRepeatedMessagesForLoop": 3,
      "loopMinSeconds": 150, "staleEvidenceSeconds": 600, "answerSynthesisMinChars": 120
    },
    "classifier": { "enabled": false, "timeoutMs": 8000, "minConfidence": 0.6, "minSecondsBetweenCalls": 60 },
    "groupOffers": { "dismissal": "per_member" },
    "outcome": { "windowSeconds": 180, "confoundWindowSeconds": 180 },
    "feedback": { "enabled": true, "promptDelaySeconds": 20 },
    "scaffolding": { "fadeAfterIndependentScenarios": 2, "requireCorroboratedNeed": true },
    "exposure": { "maxClientClockSkewSeconds": 600, "maxEventsPerMinute": 60 },
    "rewards": {
      "rewardVersion": "reward-v2-3",
      "accepted": 1, "dismissed": 1, "deferred": 0.25,
      "feedbackYes": 1, "feedbackPartly": 0.5, "feedbackNo": 1,
      "observedOutcome": 0.5, "activityResponse": 1, "independentScenario": 1,
      "notNeeded": 0.5, "helpUseful": 0.5, "selfReportedDifficulty": 0.5,
      "surveyTooMuch": 2, "surveyTooLittle": 2, "surveyAboutRight": 1
    }
  }
}
```

The `adaptivePrivate.weights` block is kept for schema compatibility; learning-aware groups use `learningAware.rewards`.

`policy-v2-3-test-accelerated` has the same structure with seconds-scale timings. It is refused unless `ADAPTIVE_V2_ALLOW_TEST_POLICY=true`, and is flagged `test_policy` in exports and integrity checks.

## 12. Configuration

| Variable | Default | V2.3 relevance |
|---|---|---|
| `ADAPTIVE_V2_DEFAULT_CONDITION` | `proactive_adaptive` | unchanged |
| `ADAPTIVE_V2_ASSIGNMENT` | `fixed` | unchanged; never auto-randomized |
| `ADAPTIVE_V2_POLICY_VERSION` | empty → `current` (`policy-v2-3`) | set to `policy-v2-2` to keep an active cohort unchanged |
| `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC` | off | enables the optional rubric |
| `ADAPTIVE_V2_ALLOW_TEST_POLICY` | off | tests and pilots only |
| `OPENAI_API_KEY` | – | without it, groups get flagged demo text (`mock`), and the classifier never runs |
