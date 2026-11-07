# Adaptive Scaffolding V2 — status

Last updated 2026-11-08. Baseline: `master` @ `57195b9`. Nothing has been deployed; all changes are uncommitted in the working tree.

Current configuration: **V2 is on by default** (no variables needed); every new group is a V2 group, home-page groups use `dual_adaptive`, group size 2–4. Study modes (formal/pilot/demo) were removed: all V2 groups are handled the same way. `ADAPTIVE_V2_ENABLED=false` switches new groups back to the original platform. Existing legacy groups are unchanged.

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

## Latest results (details in `05-test-and-release-report.md`)

- `npx tsc --noEmit -p .`: pass
- `npx eslint src server.ts tests scripts/*.mjs` (new and changed code): pass
- `npm test`: 76 pass, 0 fail
- `npm run build`: pass
- `npm run pilot:isolated`: original pilot passes with V2 switched off; V2 pilot passes with default settings (home-page group is V2 `dual_adaptive`); integrity checks clean
- `npm run db:rehearse` on a copy of `data/research.db`: additive, all 1,480 legacy rows unchanged

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
- Tests: `tests/helpers/` (`testDb.ts`, `fixtures.ts`), `tests/unit/` (2 files), `tests/integration/` (4 files), `tests/fixtures/legacy-export-columns.json`

Modified: `server.ts`, `package.json`, `README.md`, `.env.example`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/services/sessions.ts`, `src/lib/socket/index.ts`, `src/lib/ai/scaffold.ts`, `src/hooks/useCollaboration.ts`, `src/components/HomePage.tsx`, `src/components/ScenarioView.tsx`, `src/app/admin/page.tsx`, `src/app/session/[code]/page.tsx`, `src/app/session/[code]/complete/page.tsx`, and the routes `sessions`, `sessions/[code]`, `join`, `consent`, `assessment`, `messages`, `scaffold`, `scenario/[index]`, `survey`, `sync`, `reflection`, `admin/sessions`, `admin/export`.

Unchanged on purpose: scenario texts, pre/post items, survey and end questions, rubric, `src/lib/utils/export.ts` (the 8 original exports).

## Blockers (human decisions, see `03-research-protocol-and-measures.md`)

1. Approved consent/information-sheet text, contact details, retention and withdrawal handling.
2. Conditions to compare, allocation method, sample size per condition.
3. Proactive thresholds and the group-offer dismiss rule.
4. Optional instruments (initial idea, roles, agreement reason).
5. Real AI provider check (no key in this workspace); `OPENAI_API_KEY` must be set on Railway, otherwise groups get demo text.
6. Railway state unknown from here: make sure no group is mid-session when deploying.

## Next steps

1. Finalise the consent text as a new version (participants currently see the draft).
2. Commit, then follow `06` Step 0–1 (backup, deploy, verify).
3. Run the first groups with a real model; tune thresholds into a new policy version if needed.
4. Define a manual coding scheme for dialogue quality (uptake, reasoning, disagreement resolution) using the chat export.
5. Add a per-member active-time measure from presence if it is needed for analysis.
