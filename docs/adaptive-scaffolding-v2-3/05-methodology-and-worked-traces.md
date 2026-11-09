# 05: Research methodology notes and worked traces

## What V2.3 changes for the study, and what it does not

- **Instruments are frozen.** The following are byte-identical to the baseline (see the hashes in `06-test-and-release-report.md`):
  - the 8 scenarios
  - the pre-test and post-test: 8 MCQs + written Q9 each
  - the per-scenario questionnaires
  - the metacognitive questions
  - the final questionnaire
  - the rubric
  The one-click "Did this help you make progress?" is an operational interaction stored in its own table and export. It is not an assessment item.
- **Conditions are unchanged.** The conditions are `baseline_private_request`, `shared_on_demand`, `proactive_group` and `proactive_adaptive`, plus the retired `dual_adaptive` alias.
  - Home-page groups default to `proactive_adaptive` with fixed assignment.
  - Assignments are immutable.
- **Policy boundary.** `policy-v2-3` is a new version.
  - Groups on `policy-v2-2` keep their behaviour, and analyses should treat policy version as a stratum.
  - Never pool V2.3 traces with V2 rows without that variable.

## How to read the V2.3 data

1. **Estimated states are hypotheses.**
   - `group_state_estimates.state` is a cautious rule-based estimate.
   - `confidence` is a heuristic, not a calibrated probability.
   - Estimates are not diagnoses of mental states.
   - Report them descriptively, and validate them against human coding (see below) before making any claim about their accuracy.
2. **The funnel stages are distinct.** Proposed, delivered to device, seen (on screen; not proof of reading), own response, content delivered, effective proxy and human-rated are separate columns in `v2_3_offer_funnel`.
   - Do not compute "acceptance rates" over unseen offers.
   - Expired offers are `expired_unseen` or `expired_seen`, never refusals.
3. **Outcomes are associational proxies.**
   - `difficulty_resolved` is either the members' own one-click answer or an observable proxy (for example, two members talking again after a stall).
   - `understanding_evidence` is always `not_assessed`.
   - `validity` separates `usable` from `confounded` (other help in the window) and `insufficient_evidence` (not seen, or nothing observable).
   - "Support was followed by progress" is not evidence that the support caused learning.
4. **Learner-model updates are auditable.**
   - Every update has `updateApplied`, the channels changed, `evidenceQuality` and a plain note.
   - Missing data (expired, skipped, unseen, confounded) is logged with `updateApplied: false`.
   - The Thompson arms estimate "this kind of help was reported or observed to move this member forward", not knowledge.
5. **Pre/post change is within-person performance change.** It is not proof that the AI caused learning. With small samples, prefer descriptive statistics and representative traces such as the four below.

## Human evaluation protocol (research-only, optional)

- `GET /api/admin/v2-3/review?mode=sample&blind=true` returns pseudonymized decision windows. Members appear as "Member A/B/C", and names in the text are masked. The system's decision and state are hidden when `blind=true`.
- Two or more raters label each window independently. The labels are:
  - necessity: `necessary` / `unnecessary` / `uncertain`
  - support appropriateness: `appropriate` / `inappropriate` / `unclear`
  - disagreement type: `productive_disagreement` / `unproductive_conflict` / `no_disagreement` / `unclear`
  - their own collaboration-state label
- `mode=agreement` reports raw agreement, Cohen's kappa and confusion matrices for human vs human and system vs human. Kappa is reported as undefined when there are no pairs or when chance agreement is total.
- Labels are human judgements, not ground truth. The system's output is never used as its own gold standard.
- The labelling protocol (`review_protocol_version`) needs researcher approval before formal use.

## Optional open-answer rubric (off by default)

The rubric applies to the existing written Q9. Its wording, display and submission are unchanged. Four 0/1 criteria give a total of 0–4:

- recognising difficulty
- appropriate AI scope/action
- justified timing
- preserving autonomy

The score is stored in `open_answer_rubric_scores`, never mixed into the 0–8 MCQ score. It is enabled only with `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC=true`, and it is not a validated measure until the researcher and ethics committee approve it.

## Worked traces

Each trace is an automated integration test in `tests/integration/learning-aware.test.ts` on `policy-v2-3-test-accelerated`, which has seconds-scale timings: initial silence 4 s, stall 6 s, outcome window 10 s. The same logic runs on `policy-v2-3` with the production timings (120 s, 180 s, 180 s).

### Trace 1: productive disagreement leads to no action

- **Setup:** `proactive_group`, two members online.
- **Evidence (4 messages in 13 s):**
  - A: "I think option A is better because it protects the patients privacy"
  - B: "I disagree, option B is stronger because the hospital budget matters more"
  - A: "But what about long-term trust? For example people stop sharing data"
  - B: "No, the evidence shows budgets decide which clinics stay open next year"
- **Estimate:** state `constructive_disagreement`. The members disagree, but every message adds new reasons. The estimate row is linked to the evaluation (`evaluation_id`) and lists its evidence.
- **Decision:** `no_action`, reason `context_constructive_disagreement` ("productive disagreement is left alone"). No group offer was created.
- **Unknowns:** whether either view is correct, and whether the members understood each other. The system makes no claim about either.

### Trace 2: a genuine stall leads to a shared prompt

- **Setup:** `proactive_group`, two members online.
- **Evidence:** A writes "I think the first option is risky because of the cost", B replies "ok", and then nothing happens for 10 s (stall threshold 6 s).
- **Estimate:** `possible_stall`.
- **Decision:** offer, trigger `stalled_discussion`, scope `group`, status `suggested` with no content yet. It is broadcast once to the group room; nothing is sent to an individual member's channel.
- **Exposure:** `server_created` is recorded for both members. Each client then reports `socket_delivered`, and `client_displayed_in_viewport` once the card is on screen; that client step is exercised over real HTTP and Socket.IO in the isolated pilot.
- **Response:** A opens the suggestion. It is generated once and delivered to the whole group, and B's view shows the content.
- **After:**
  - B: "Let's compare the long-term costs then"
  - A: "Good idea, I will list the staffing risks"
- **Outcome (after the window):**
  - subject `group`
  - `difficulty_resolved = yes` (two members talking again)
  - `was_visible = true`
  - `understanding_evidence = not_assessed`
  - `update_applied = false`
  - no learner-model events for either member, because group outcomes never train an individual model
- **Unknowns:** whether the prompt caused the restart, which is associational only, and whether the subsequent reasoning is correct.

### Trace 3: private confusion leads to a minimal nudge, with optional escalation

- **Setup:** `proactive_adaptive`.
- **Evidence:** B writes a reasoned message. A then writes "I'm confused, I don't understand why the budget matters here", and nobody answers.
- **Group decision:** no group prompt. One member's confusion is handled privately.
- **Private decisions:**
  - A: offer, tier `minimal`, move `offer_minimal`, support `guiding_question` (level 1), linked to the group estimate. It has no AI text until A clicks Yes, and it is emitted only to `participant:A`.
  - B: wait, reason `need_not_corroborated`. A pause alone is not a need.
- **Responses:**
  - A accepts, and the help is delivered to A only.
  - B trying to answer A's one-click question gets 404.
  - A answers **No**.
- **Learning:**
  - The guiding-question arm's β increases by 1 (explicit feedback).
  - Scaffolding event `escalation` from `minimal` to `moderate`, reason `minimal_help_insufficient:member_said_help_was_not_enough`.
  - A second answer from A is ignored (`duplicate: true`, no extra update).
- **Escalation:**
  - A writes "I'm still confused, I don't get how staff costs connect".
  - The decision is to offer an `explanation` (level 2), tier `moderate`, move `escalate`.
  - A may decline it, and in the test A does (status `dismissed`).
- **Outcome for the first nudge:**
  - subject A
  - `resolution_source = feedback`
  - `difficulty_resolved = no`
  - `was_visible = true`
  - the feedback is not counted a second time
- **Unknowns:** A's understanding (`not_assessed`). The escalation is a contingent offer, not a judgement of A's ability.

### Trace 4: independent work leads to fading

- **Setup:** `proactive_adaptive`.
- **Scenarios 1 and 2:** A contributes their own reasoning without any AI help, and the group submits. Each scenario logs `scenario_outcome = independent`, adding 1 to A's independence.
- **Scenario 3 start:**
  - Scaffolding event `fade_start:3` moves A's tier to `no_offer`, reason `independent_scenarios_before`.
  - A's private trace is a wait, reason `faded_after_independent_work`.
  - No popup is shown, but the group still receives its process prompt.
- **Re-evaluation:**
  - A writes "I'm confused, I don't understand this third case".
  - A minimal level-1 offer is made (tier `no_offer`, move `offer_minimal`).
  - Fading lowers intrusion on inferred need only; it never blocks a member's explicit need, and each new scenario re-derives the tier.
- **Unknowns:** whether "independent" contributions were correct. Independence here means contributing without AI help, not mastery.
