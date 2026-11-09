# 01: Audit and implementation plan (V2.3 learning-aware extension)

Branch `feature/adaptive-v2-3-learning-aware`, created from `master` at `d3cbed4` ("Update assessments and research scenarios"). All V2.3 changes are uncommitted in the working tree and not deployed.

## Baseline, taken before any change

| Item | Baseline |
|---|---|
| `src/data/assessment.json` SHA-256 (file bytes) | `C119297D31C8536C9E0C8F6D1EE9AB1F4B91198D1CA923B8481B5404AE08B9FA` |
| `src/data/scenarios.json` SHA-256 (file bytes) | `49035E72F8EC39C88AF4EAEBCE13F17C3D05108B9175BEFCE7F7E3A14527ECBA` |
| Stored instrument versions (SHA-256 of the parsed JSON) | `assessment-sha256-6c3f9d24a87a`, `scenarios-sha256-3fdfbc884c7a` |
| Scenarios | 8, in the existing order (no 9/10); final answer limit 500 words |
| Pre-test and post-test | 8 scored MCQs + 1 required written Q9 each; one-time submission |
| `npm test` | 105 pass, 0 fail |
| `data/research.db` | SHA-256 `F9DE91FC91731FCCE3F7E2C749FD63B72410A30F785A7C79A38A6E47354AAF00`, 729,088 bytes; legacy-only (24 legacy groups, no V2 tables) |

## Reference document vs repository

The master prompt describes the V2 baseline from the guide "6 - How the Application Works with V2". The repository matched it on every point that was checked:

- eight scenarios
- `proactive_adaptive` as the home-page default
- `policy-v2-2` as the current policy
- per-member consent and device token
- group size 2–4
- six private Step 2 options and five manual group actions
- 15 V2 tables and 13 V2 exports
- a 5-second scheduler (`ADAPTIVE_V2_SCHEDULER_MS`)
- 105 tests

The following differences from the prompt's suggested structure were found and handled:

| Prompt suggests | Repository has | Decision |
|---|---|---|
| `PolicyRegistry.ts` | `src/lib/intervention/policies.ts` + `src/data/intervention-policies.json` | Extended the existing registry |
| `ResearchLogger.ts` | `InterventionResearchLogger.ts` | Reused; V2.3 rows are written by the orchestrator next to it |
| `AdaptiveScaffoldingEngine.ts` for escalation/fading | That file is the Step 2 rule engine | Left unchanged; proactive escalation/fading is in `learning/ScaffoldingState.ts` |
| `POST .../interventions/[id]/feedback` (new) | Already exists (accept/dismiss/defer) | Kept; added `exposure` and `progress` routes next to it |
| `GET /api/sessions/[code]/intervention-status` | `GET /api/sessions/[code]/interventions` already returns the member's state | Added a `learningAware` block to that response instead of a new route |
| A dismissal rule for shared offers | V2 closes a shared offer for everyone on the first dismissal | Kept for older policies; `policy-v2-3` uses per-member dismissal |

## Inventory

- **Existing and reused:**
  - `CollaborationMonitor` (activity triggers)
  - `InterventionDecisionEngine` (deterministic policy)
  - `InterventionOrchestrator` (the only scheduler entry point and offer lifecycle)
  - `PersonalInterventionCoach` and `GroupAIFacilitator` (the only AI provider client)
  - the per-member learner model (Normal-Inverse-Gamma pace, Beta independence and receptiveness, and 3 Thompson arms)
  - `LearnerModelStore` (idempotent events with before/after state)
  - the export and integrity tooling
- **Missing:**
  - group-state estimation
  - a context gate
  - per-member exposure
  - outcome evaluation separated from engagement
  - a reward policy that treats missing data as missing
  - contingent escalation/fading with a stop preference
  - private decision traces
  - human-review labels and agreement statistics
  - an optional open-answer rubric
  - V2.3 exports
- **Requires modification:** the decision engine (context gate), orchestrator wiring, learner store (versioned reward policy), the facilitator panel and popup UI, the hydration endpoint, exports, the dashboard and the integrity checker.
- **Risks:**
  - silently switching a running `policy-v2-2` cohort
  - leaking private offers through group broadcasts or exports
  - counting unseen offers as refusals
  - double-counting feedback
  - over-claiming learning from activity
- **Affected tests:** `research-config` (current policy). All other 105 baseline tests must stay green unchanged.
- **Migration path:** additive `drizzle-kit push` only (8 new tables, no column changes); rehearsed on a copy.
- **Rollout flags:**
  - `ADAPTIVE_V2_POLICY_VERSION` pins new groups to a policy, so a `policy-v2-2` cohort can continue unchanged.
  - `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC` is off by default.
  - `ADAPTIVE_V2_ALLOW_TEST_POLICY` enables the test policy only.

## Plan (mandatory order) and outcome

| Phase | Content | Status |
|---|---|---|
| A | Audit | done (this document) |
| B | `policy-v2-3`, `policy-v2-3-test-accelerated`, typed contracts, release flag | done |
| C | `GroupStateEstimator` (deterministic + optional rate-limited classifier) | done |
| D | Decision-engine context gate, orchestrator wiring, estimate logging | done |
| E | `OfferExposureService`, per-member dismissal, exposure/progress/stop routes, indicator UI | done |
| F | `OutcomeEvaluator`, `BanditRewardPolicy` (reward-v2-3), `LearnerEvidenceAggregator` | done |
| G | Scaffolding state (escalation, fading, reassess, stop), private decision traces | done |
| H | Additive schema, `v2_3_*` exports, dashboard section, integrity checks, rehearsal | done |
| I | Human review labels + agreement; optional open-answer rubric | partial: admin API and agreement display only, no labelling/scoring form in `/admin` |
| J | Tests, type check, lint, build, isolated pilots, rehearsal, integrity check, hashes | done |
| K | Documentation and final report | done |
