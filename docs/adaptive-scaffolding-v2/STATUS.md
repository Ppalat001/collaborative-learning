# Adaptive Scaffolding V2 — status

Last updated 2026-11-08. Pushed to `master` up to `4654ce4` (private AI coach removed). The adaptive private suggestions (phase 7) are **uncommitted** in the working tree and not deployed.

Current configuration (working tree): **V2 is on by default** (no variables needed); every new group is a V2 group, home-page groups use `proactive_adaptive` on `policy-v2-2` (shared facilitator plus adaptive private popups), group size 2–4. Groups created earlier keep their condition (`proactive_group`). The private coach is removed from participant use. `dual_adaptive` remains a recognised stored value only so existing assignments and historical exports keep their provenance; it no longer enables private offers. Study modes (formal/pilot/demo) were removed: all V2 groups are handled the same way. `ADAPTIVE_V2_ENABLED=false` can still be used explicitly to create legacy groups.

## Phases

| Phase | State | Exit check |
|---|---|---|
| 0 Audit, backup, plan | done | `01-existing-system-audit.md`, `02-implementation-plan.md`; backup `data/backups/research-pre-v2-20261107-201756.db` |
| 1 Research validity foundations | done | eligibility integration tests |
| 2 Shared collaboration | done | intervention integration tests, V2 pilot |
| 3 Proactive group detection | done | monitor/decision unit tests, orchestrator integration tests |
| 4 Opt-in private offers, fading, sharing | done | privacy routing tests (incl. mutation check), V2 pilot |
| 5 Versions, dashboard, exports, integrity | done | export tests, integrity checker, migration rehearsal |
| 6 Production readiness | done in this workspace; **human steps open** | build, isolated pilots; see blockers |
| 7 Adaptive private suggestions (`proactive_adaptive`, per-member Bayesian learner model, popups) | done in this workspace; uncommitted | unit + simulation + integration tests, V2 pilot popup flow, migration rehearsal |

## Latest results (details in `05-test-and-release-report.md`)

- `npx tsc --noEmit -p .`: pass
- `npx eslint .`: 0 errors (5 pre-existing warnings in `.teacher-docs-src/` and older scripts)
- `npm test`: 103 pass, 0 fail
- `npm run build`: pass
- `npm run pilot:isolated`: original and V2 pilots pass (including the popup flow); 0 integrity violations
- `npm run db:rehearse` on a copy of `data/research.db`: additive, all 1,480 legacy rows unchanged; adds `learner_models` and `learner_model_events`

## Files

Created:
- `docs/adaptive-scaffolding-v2/` 01–06 and this file
- `src/data/study-protocol.json`, `src/data/intervention-policies.json`
- `src/lib/intervention/` `types.ts`, `policies.ts`, `validators.ts`, `prompts.ts`, `CollaborationMonitor.ts`, `InterventionDecisionEngine.ts`, `AdaptiveScaffoldingEngine.ts`, `GroupDiscussionCoordinator.ts`, `ResearchConditionManager.ts`, `ResearchEligibilityGuard.ts`, `InterventionResearchLogger.ts`, `InterventionOrchestrator.ts`, `presence.ts`
- `src/lib/ai/` `provider.ts`, `GroupAIFacilitator.ts`, `PersonalInterventionCoach.ts`
- `src/lib/auth/` `participantAuth.ts`, `routeAuth.ts`; `src/lib/client/participant.ts`; `src/lib/realtime/emit.ts`
- `src/lib/services/` `interventions.ts`, `studyV2.ts`; `src/lib/utils/exportV2.ts`
- `src/hooks/useInterventions.ts`
- `src/components/` `ResearchConsentForm.tsx`, `V2LobbyPanel.tsx`, `GroupDiscussionStarter.tsx`, `GroupAIFacilitatorPanel.tsx`, `InterventionFeedbackControls.tsx`, `PersonalInterventionOffer.tsx`, `V2PrivateTools.tsx`, `ResearcherInterventionDashboard.tsx`
- API: `sessions/[code]/start`, `sessions/[code]/interventions`, `sessions/[code]/interventions/[id]/feedback`, `sessions/[code]/collaboration`, `admin/interventions`, `admin/dropout`
- Scripts: `run-tests.mjs`, `pilot-adaptive-v2.mjs`, `pilot-isolated.mjs`, `rehearse-migration.mjs`, `verify-research-integrity.mjs`, `inspect-db.mjs`
- Tests: `tests/helpers/` (`testDb.ts`, `fixtures.ts`), `tests/unit/` (3 files), `tests/integration/` (5 files), `tests/fixtures/legacy-export-columns.json`
- Phase 7: `src/lib/intervention/adaptive/` (`LearnerModel.ts`, `AdaptivePrivatePolicy.ts`, `rewards.ts`, `LearnerModelStore.ts`, `AdaptiveLearner.ts`), `src/components/PrivateSuggestionPopup.tsx`, `tests/unit/adaptive-learner.test.ts`, `tests/integration/adaptive-private.test.ts`; removed `src/components/PersonalInterventionOffer.tsx`

Modified: `server.ts`, `package.json`, `README.md`, `.env.example`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/services/sessions.ts`, `src/lib/socket/index.ts`, `src/lib/ai/scaffold.ts`, `src/hooks/useCollaboration.ts`, `src/components/HomePage.tsx`, `src/components/ScenarioView.tsx`, `src/app/admin/page.tsx`, `src/app/session/[code]/page.tsx`, `src/app/session/[code]/complete/page.tsx`, and the routes `sessions`, `sessions/[code]`, `join`, `consent`, `assessment`, `messages`, `scaffold`, `scenario/[index]`, `survey`, `sync`, `reflection`, `admin/sessions`, `admin/export`.

Unchanged on purpose: scenario texts, pre/post items, survey and end questions, rubric, `src/lib/utils/export.ts` (the 8 original exports).

## Blockers (human decisions, see `03-research-protocol-and-measures.md`)

1. Approved consent/information-sheet text, contact details, retention and withdrawal handling.
2. Conditions to compare, allocation method, sample size per condition.
3. Proactive thresholds and the group-offer dismiss rule.
4. Optional instruments (initial idea, roles, agreement reason).
5. Real AI provider check (no key in this workspace); `OPENAI_API_KEY` must be set on Railway, otherwise groups get demo text.
6. Railway state unknown from here: make sure no group is mid-session when deploying.
7. Adaptive private suggestions: confirm the priors, threshold and safety limits in `policy-v2-2` and the `proactive_adaptive` disclosure text (protocol `adaptive-v2-protocol-draft-3`) before real participants see the popups.

## Next steps

1. Finalise the consent text as a new version (participants currently see the draft).
2. Commit, then follow `06` Step 0–1 (backup, deploy, verify).
3. Run the first groups with a real model; tune thresholds into a new policy version if needed.
4. Define a manual coding scheme for dialogue quality (uptake, reasoning, disagreement resolution) using the chat export.
5. Add a per-member active-time measure from presence if it is needed for analysis.
