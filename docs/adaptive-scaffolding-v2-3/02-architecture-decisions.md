# 02: Architecture decision record (V2.3)

Each decision lists the context, the choice made, and its consequences. They are written for the dissertation's method chapter.

## ADR-1: A new immutable policy version; older groups never change

- **Context:** groups store their policy version in `study_assignments`, which is immutable (enforced by a database trigger). A cohort may still be collecting data on `policy-v2-2`.
- **Decision:**
  - Add `policy-v2-3` and `policy-v2-3-test-accelerated` (test-only) to `intervention-policies.json`, and set `current` to `policy-v2-3`.
  - `policy-v2-1`, `policy-v2-2` and `policy-v2-test-accelerated` are byte-identical to `master` (verified by comparing the parsed JSON).
  - New groups get the current policy unless `ADAPTIVE_V2_POLICY_VERSION` pins another one.
  - A policy enables V2.3 only through its `learningAware` block.
- **Consequences:**
  - Existing groups keep their behaviour and exports.
  - A researcher running a `policy-v2-2` cohort must set `ADAPTIVE_V2_POLICY_VERSION=policy-v2-2` before deploying. This is listed in the deployment steps.

## ADR-2: Separate observation, inference, decision, exposure, outcome and learning

- **Decision:** each concept has its own module and table:
  - activity: `CollaborationMonitor`
  - inferred state: `GroupStateEstimator` → `group_state_estimates`
  - decision: `InterventionDecisionEngine` / `LearningAwarePrivateDecision` → `intervention_evaluations` / `private_decision_traces`
  - exposure: `OfferExposureService` → `offer_exposures`
  - outcome: `OutcomeEvaluator` → `intervention_outcome_evaluations`
  - learning: `BanditRewardPolicy` via `LearnerEvidenceAggregator` → `learner_model_events`
- **Consequence:** a researcher can reconstruct, for every evaluation and offer:
  - why it was or was not made
  - what was observable
  - whether it was seen
  - whether a model update was justified

## ADR-3: Deterministic estimator first; the classifier can only lower confidence

- **Context:** a language model could label collaboration states, but its output is unverifiable and costs money per call.
- **Decision:**
  - The estimator is a pure, deterministic function of human chat, answer-edit summaries and checkpoints. It compares the recent window with earlier content (new reasons, repeated statements, answer revisions) rather than counting words.
  - An optional classifier (`learningAware.classifier.enabled`, off in `policy-v2-3`) is consulted only for ambiguous estimates, only with real AI configured, and at most once per `minSecondsBetweenCalls`.
  - It sees pseudonymous speakers ("Member A/B/C") and withholds suspected prompt-injection text.
  - Its output must pass a strict schema and cite existing message IDs.
  - It may change the state, but never raises confidence above the deterministic estimate.
  - Timeouts and invalid output keep the deterministic estimate.
- **Consequence:** confidence is a heuristic score, not a calibrated probability. This is labelled as such in exports and the dashboard.

## ADR-4: A context gate on inferred group triggers only

- **Decision:**
  - When a learning-aware policy has a group-state estimate, inferred triggers (`initial_silence`, `stalled_discussion`, `unresolved_disagreement`, `possible_participation_imbalance`) are suppressed in these cases:
    - the group is `productive` or in `constructive_disagreement`
    - the estimate is `uncertain` or below `contextGate.minConfidenceToAct`
    - the estimate does not show the difficulty the trigger requires
  - Explicit requests (`explicit_confusion`, `coordination_request`) are never gated.
  - After a delivered group prompt, no new prompt is offered during the outcome window (`awaiting_outcome`).
  - A trigger whose earlier prompt in the scenario had a usable "no" outcome is not repeated (`previous_prompt_ineffective`).
- **Rejected:** a group-level Thompson bandit. There are too few unbiased, repeated group outcomes, and it would be fragile and hard to audit.

## ADR-5: Per-member exposure; only verifiable steps

- **Decision:**
  - Exposure kinds:
    - `server_created` and `socket_delivered`
    - `client_displayed_in_viewport` (`IntersectionObserver`, visible tab)
    - `user_opened`
    - `accepted`, `deferred` and `dismissed`
    - `indicator_dismissed`
    - `expired_seen` and `expired_unseen`
  - Nothing claims "read".
  - The client clock is stored only within `maxClientClockSkewSeconds`; otherwise `client_clock_rejected = true`.
  - Each (intervention, member, kind) triple is stored once; replays are reported as duplicates.
  - Reports are rate-limited per member (`maxEventsPerMinute`).
- **Consequence:** an offer that expires is recorded as `expired_unseen` or `expired_seen`, and neither counts as a refusal.

## ADR-6: Per-member dismissal of shared offers

- **Decision:** under `learningAware.groupOffers.dismissal = "per_member"`:
  - A member's dismissal hides the shared offer only for that member.
  - The offer closes when every active member's latest response is a dismissal, or when it expires or is accepted.
  - Group broadcasts carry anonymous counts only.
  - Older policies keep "first dismissal closes for all".

## ADR-7: reward-v2-3: missing is missing; engagement is not learning

- **Decision:**
  - Updates are kept in separate channels:
    - receptiveness: explicit responses only
    - help effectiveness: the Thompson arms, from the member's own one-click answer or a usable observed outcome at half weight
    - activity response: engagement only, never used to choose help
    - independence
  - Expired offers, "Skip", unseen help, insufficient or confounded outcomes, and higher Step 2 usage change nothing. They are still logged with `updateApplied: false` and reward null.
  - "Partly" is a documented fractional pseudo-count on both sides.
  - Group outcomes never update a member's model.
- **Consequence:** the Thompson arms estimate "this kind of help was reported or observed to move this member forward". That is not a probability of knowledge.

## ADR-8: Contingent scaffolding with a hard stop

- **Decision:** the per-member tier is one of `minimal`, `moderate`, `reassess` or `no_offer`:
  - Escalation to `moderate` (explanation allowed) happens only after the member said minimal help was not enough, or a usable observation shows the difficulty persisted.
  - A Step 2 request is not such evidence.
  - Fading (`no_offer`) happens after `fadeAfterIndependentScenarios` consecutive independent scenarios, or after "I didn't need it".
  - When faded, the member's own explicit "I'm unsure" still allows a minimal offer.
  - Each new scenario re-derives the tier.
  - "Don't suggest again in this scenario" is a hard stop for proactive popups in that scenario. It never blocks Step 2.
  - Without reliable evidence the tier does not change.
  - The V2 caps still apply first.

## ADR-9: No new infrastructure

- **Decision:** there is no second scheduler, socket server, state store or AI client.
  - V2.3 runs inside `InterventionOrchestrator.runEvaluation` on the existing scheduler and event triggers.
  - It uses the existing Socket.IO emit helpers and the existing provider wrapper.
  - The one-replica assumption is unchanged.

## ADR-10: Research-only evaluation tools are opt-in and separate

- **Human review labels:**
  - Researchers label pseudonymized decision windows (blind by default: the system's decision is hidden).
  - Agreement is computed as raw agreement, Cohen's kappa and a confusion matrix.
  - Labels are human judgements, not ground truth about mental states.
- **Open-answer rubric:**
  - Off unless `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC=true`.
  - Four 0/1 criteria, scored 0–4, stored apart from the unchanged 0–8 MCQ score.
  - Needs researcher and ethics approval before formal use.
