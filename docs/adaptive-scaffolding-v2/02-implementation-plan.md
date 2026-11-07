# 02 — Implementation plan

> **Changed on 2026-11-08:** the formal/pilot/demo study modes described below were removed (all V2 groups are handled the same way), and V2 is now on by default with `dual_adaptive` for home-page groups. Current behaviour: `06-researcher-operating-guide.md`.

## Guiding decisions

1. **Opt-in per group, never retroactive.** A group is V2 only if it has a row in the new `study_assignments` table, written once at creation. Every existing group has no such row and keeps the legacy code paths. No migration touches existing rows.
2. **Release flags default to off.** With no new environment variables, the deployed app behaves exactly like `57195b9` for participants (`ADAPTIVE_V2_ENABLED=false`).
3. **Fail closed for research-critical operations** (consent, condition, auth, start gate, formal-mode AI availability); **fail soft for facilitation** (chat/editor keep working if AI fails).
4. **Additive SQLite schema** applied by the existing `drizzle-kit push`: new tables plus one nullable column (`participants.auth_token_hash`). Immutability of assignments is enforced by a SQLite trigger created at startup.
5. **Shared server state through `globalThis`** (Socket.IO server, presence, orchestrator) because Next route handlers and `server.ts` load separate module graphs in one process. Single replica remains required.
6. **Deterministic first.** Monitoring and decisions are rule-based and versioned; the optional model classifier is off by default and never runs in passive conditions.

## Proposed file structure (as implemented)

```text
src/lib/intervention/
  types.ts                       domain unions, contracts, constants
  policies.ts                    versioned policy loader (data/intervention-policies.json)
  validators.ts                  runtime validation (requests, classifier JSON, AI output)
  prompts.ts                     facilitator/coach prompt builders + safe templates
  CollaborationMonitor.ts        snapshot → assessments (rules + optional classifier)
  InterventionDecisionEngine.ts  assessments + context → decision (incl. no_action)
  AdaptiveScaffoldingEngine.ts   least-intrusive level recommendation + fading
  GroupDiscussionCoordinator.ts  opening prompt, role rotation, stages, checkpoints
  ResearchConditionManager.ts    assignment at creation, condition capabilities, versions
  ResearchEligibilityGuard.ts    consent/size/pre-test/roster/membership gates
  InterventionResearchLogger.ts  evaluation/offer/delivery/feedback/failure records
  InterventionOrchestrator.ts    server-side glue, debounce, idempotency, broadcast
  presence.ts                    connected-participant tracking shared with sockets
src/lib/ai/
  provider.ts                    shared Responses API call (timeouts, usage, mock detection)
  GroupAIFacilitator.ts          shared process prompts
  PersonalInterventionCoach.ts   opt-in private offers and support
src/lib/auth/participantAuth.ts  token issue/verify, request authentication
src/lib/realtime/emit.ts         DB-first broadcast helpers (room vs private)
src/lib/services/interventions.ts persistence/query API (visibility-filtered)
src/lib/services/studyV2.ts      consent, start, roster, instruments services
src/lib/utils/exportV2.ts        versioned V2 CSV builders
src/lib/client/participant.ts    browser token headers
src/data/study-protocol.json     consent text/version, group sizes, default features
src/data/intervention-policies.json  versioned thresholds (pilot defaults, not validated)
src/hooks/useInterventions.ts    socket + API reconciliation
src/components/ (new)            GroupAIFacilitatorPanel, PersonalInterventionOffer,
                                 InterventionFeedbackControls, GroupDiscussionStarter,
                                 ResearchConsentForm, ResearcherInterventionDashboard
src/app/api/sessions/[code]/     consent (per person for V2), start, interventions,
                                 interventions/[id]/feedback, instruments, preferences, share
src/app/api/admin/               interventions (status, timeline, V2 export), sessions POST
scripts/                         pilot-adaptive-v2.mjs, verify-research-integrity.mjs,
                                 inspect-db.mjs, run-tests.mjs
tests/                           unit + integration tests (node:test via tsx, disposable DB)
```

## Phases

| Phase | Scope | Exit check |
|---|---|---|
| 0 | Audit, DB backup, plan, STATUS | docs exist, backup taken |
| 1 | Assignments, per-person consent, tokens, size gate, all-member pre-test gate, roster freeze, socket auth, lobby UI | unit + integration tests, lint, typecheck |
| 2 | Opening prompt, roles/initial idea/agreement reason (flags), checkpoints, manual shared facilitator, shared timeline, socket events | tests, lint, typecheck |
| 3 | Monitor, decision engine, orchestrator, logger, scheduler, presence, idempotency, no-action logging | tests incl. idempotency/cooldown/productive-debate |
| 4 | Opt-in private offers, "I'm stuck", adaptive level + fading, explicit sharing | tests incl. privacy routing |
| 5 | Admin dashboard, V2 exports, data dictionary, integrity script | export tests, legacy header tests |
| 6 | Build, legacy pilot, V2 multi-client pilot, docs, release guide | all commands run, results recorded |

## Risks

| Risk | Mitigation |
|---|---|
| `drizzle-kit push` prompts (non-interactive Railway start would hang) | Only new tables + nullable column; verified against a copy of the real DB |
| Changing behavior of ongoing sessions | Legacy = no assignment row; legacy paths unchanged; flags off by default |
| Condition changed mid-study | Trigger rejects updates to assignment columns; no API to change them |
| Pilot/demo mixed with formal data | `study_mode` on every V2 row/export; cross-group V2 export defaults to formal only; legacy groups labelled `legacy` |
| Mock AI in formal study | Formal creation requires a configured key; generation refuses mock in formal mode |
| Private content leakage | Visibility filtered in the query layer; private events only to `participant:<id>` socket room after token check |
| Duplicate AI calls under concurrency | Unique idempotency keys + atomic `suggested→accepted` transition + in-flight guard |
| Route handlers and server in different module graphs | Shared state on `globalThis`; verified by the multi-client pilot |
