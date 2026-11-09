# Adaptive Scaffolding V2.3 (learning-aware): status and changelog

Last updated 2026-11-09. Branch `feature/adaptive-v2-3-learning-aware` (from `master` `d3cbed4`). All changes are **uncommitted and not deployed**.

**Configuration in the working tree:**

- New V2 groups get `policy-v2-3`, or the policy pinned by `ADAPTIVE_V2_POLICY_VERSION`.
- Home-page groups stay `proactive_adaptive` with fixed assignment.
- Existing groups keep their stored policy.
- `policy-v2-2` and every older version are unchanged.

**Documents:**

1. `01-audit-and-plan.md`: baseline, discrepancies, inventory, phase status
2. `02-architecture-decisions.md`: ADR-1 … ADR-10
3. `03-developer-guide.md`: pipeline, estimator, gates, rewards, outcomes, API/sockets/UI, schema, exports, full `policy-v2-3`, configuration
4. `04-participant-explanation.md`: plain-language draft (needs ethics review)
5. `05-methodology-and-worked-traces.md`: how to read the data, the human-review protocol, the four worked traces
6. `06-test-and-release-report.md`: commands and results, hashes, test matrix, limitations, ethics items, deployment and rollback

## Latest results

- `npm test`: 160 pass, 0 fail
- `npx tsc --noEmit -p .`: exit 0
- `npm run lint`: 0 errors, 5 warnings in untouched files
- `npm run build`: success
- `npm run pilot:isolated`: passed, including the V2.3 group over HTTP and Socket.IO; 0 integrity violations
- `npm run db:verify` on `data/research.db`: legacy-only, 0 violations
- `npm run db:rehearse` on a copy: additive; all 12 existing tables unchanged
- Instrument hashes and the `data/research.db` hash are unchanged

## Changelog

### Added

- `src/lib/intervention/GroupStateEstimator.ts`: deterministic group stage/state estimate; optional pseudonymized, rate-limited classifier refinement
- `src/lib/intervention/OfferExposureService.ts`: per-member exposure records, client report validation, rate limit, expiry seen/unseen
- `src/lib/intervention/OutcomeEvaluator.ts`: observed outcome per delivered proactive offer (activity, resolution proxy, feedback, visibility, confounds, validity)
- `src/lib/intervention/learning/`:
  - `BanditRewardPolicy.ts` (reward-v2-3)
  - `LearnerEvidenceAggregator.ts` (routes signals to the learner store; stop preference)
  - `LearningAwarePrivateDecision.ts`
  - `ScaffoldingState.ts`
  - `GroupStateMemory.ts` (estimate memory, last delivery, ineffective triggers)
  - `HumanReview.ts` and `ReviewAgreement.ts`
  - `OpenAnswerRubric.ts` and `OpenAnswerRubricService.ts`
- `src/lib/utils/exportV23.ts`: nine `v2_3_*` exports and the dashboard section
- API routes:
  - `src/app/api/sessions/[code]/interventions/[id]/exposure/route.ts`
  - `.../progress/route.ts`
  - `src/app/api/admin/v2-3/review/route.ts`
  - `src/app/api/admin/v2-3/open-rubric/route.ts`
- UI: `src/components/GroupSuggestionIndicator.tsx`, `src/components/ProgressFeedbackPrompt.tsx`
- Tests: `tests/unit/learning-aware.test.ts` (40), `tests/integration/learning-aware.test.ts` (13)
- `docs/adaptive-scaffolding-v2-3/`

### Modified

- `src/data/intervention-policies.json`: added `policy-v2-3` and `policy-v2-3-test-accelerated`; `current` → `policy-v2-3`. Older versions are identical.
- `src/lib/intervention/policies.ts`: `learningAware` types and validation, `learningAwareOf`.
- `src/lib/intervention/types.ts`: V2.3 contracts (stages, states, evidence refs, estimate, proposal, outcome, exposure kinds, tiers, member state).
- `src/lib/intervention/ResearchConditionManager.ts`: `ADAPTIVE_V2_POLICY_VERSION` release flag for new groups.
- `src/lib/intervention/InterventionDecisionEngine.ts`: context gate, `awaiting_outcome`, `previous_prompt_ineffective`, and their explanations.
- `src/lib/intervention/InterventionOrchestrator.ts`:
  - estimate logging and per-member dismissal
  - exposure recording and progress feedback
  - stop preference, learning-aware private decisions and traces
  - outcome evaluation
  - no re-offer for an unchanged decision draw
- `src/lib/intervention/adaptive/LearnerModel.ts`, `LearnerModelStore.ts` and `AdaptiveLearner.ts`: an optional activity channel, versioned reward routing, and logging of unchanged signals (`updateApplied: false`). The V2 rules are unchanged for older policies.
- `src/lib/db/schema.ts`: 8 additive tables.
- `src/lib/services/interventions.ts`: the member's `learningAware` state in hydration, and per-member dismissal in views.
- `src/app/api/sessions/[code]/interventions/route.ts`: the `stop_proactive_for_scenario` kind.
- `src/app/api/admin/export/route.ts`: `v2_3_*` types.
- `src/app/api/admin/interventions/route.ts`: the V2.3 dashboard section and the learning-aware flag per policy.
- Components:
  - `GroupAIFacilitatorPanel.tsx`: viewport exposure, per-member dismissal
  - `PrivateSuggestionPopup.tsx`: exposure, stop option, one-click feedback
  - `ScenarioView.tsx`: indicator and wiring
  - `ResearcherInterventionDashboard.tsx`: V2.3 section, agreement
  - `src/hooks/useInterventions.ts`: exposure, progress, stop
- `scripts/verify-research-integrity.mjs`: V2.3 checks (rows for older policies, private leak, member/group, feedback on undelivered, learning from unseen/group/insufficient evidence, understanding claims, rubric range).
- `scripts/rehearse-migration.mjs`: requires the 8 V2.3 tables.
- `scripts/pilot-adaptive-v2.mjs`: the V2.3 group section.
- `.env.example`: `ADAPTIVE_V2_POLICY_VERSION`, `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC`.
- `tests/unit/research-config.test.ts`: the current policy and release-flag tests.

### Unchanged on purpose

- `src/data/assessment.json` and `src/data/scenarios.json`
- the survey, metacognitive and final questions
- the rubric
- the 8 original exports (`src/lib/utils/export.ts`) and the 13 V2 exports (`exportV2.ts`)
- the 15 V2 tables
- Step 2 options and manual group actions
- `AdaptiveScaffoldingEngine.ts` (Step 2)

## Blockers (human decisions)

1. The consent text is still `consent-v2-draft-1`, with a placeholder contact and unapproved retention wording. Formal data collection must not start until an approved, versioned text exists.
2. The new participant-facing wording and the new data collected need ethics approval and a protocol/information-sheet update (see `06`).
3. Decide whether a cohort is running on `policy-v2-2`. If so, set `ADAPTIVE_V2_POLICY_VERSION=policy-v2-2` before deploying.
4. Confirm the `policy-v2-3` starting values. Approve the human-review protocol and rubric before formal use.
5. A real AI key is needed on the server. Without it, groups get flagged demo text and the classifier never runs.
