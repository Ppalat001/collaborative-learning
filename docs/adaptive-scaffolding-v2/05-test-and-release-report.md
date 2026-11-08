# 05 — Test and release report

> Historical report for the original V2 release. The private AI coach documented in this report was later removed from participant use; current behaviour is in `06-researcher-operating-guide.md`. Results for the adaptive private suggestions are in the last section.

All results below were produced in this workspace on 2026-11-08 (Windows, Node 25.8.0), after V2 was made the default and study modes were removed. Every automated test and pilot ran on a **throwaway SQLite database** in the OS temp folder; `data/research.db` was opened read-only (integrity check, inspection, migration rehearsal) and its timestamp was unchanged. All AI in tests and pilots was **mock** (no API key available), and every such group carries the `mock_ai_output` flag.

## Commands and results

| Command | What it checks | Result |
|---|---|---|
| `npx tsc --noEmit -p .` | TypeScript, whole project incl. tests | pass (0 errors) |
| `npx eslint src server.ts tests scripts/*.mjs` (new/changed code) | lint | pass (0 problems). Pre-existing warnings in `.teacher-docs-src/` and older scripts were not touched |
| `npm test` | 76 unit + integration tests, 19 suites | **76 pass, 0 fail** (~4 s) |
| `npm run build` | Next.js production build | pass; 26 routes incl. 6 new API routes |
| `npm run pilot:isolated` | production server on a throwaway DB: original pilot with V2 switched **off** (`ADAPTIVE_V2_ENABLED=false`), then the V2 end-to-end pilot with **default settings** (only the test policy allowed); integrity check after each | **all pass**; 0 integrity violations |
| `npm run db:rehearse` (copy of local `data/research.db`) | additive migration, every legacy row unchanged | pass (12 tables, 1,480 rows byte-identical; 13 tables + 1 column added) |
| `npm run db:verify` (local `data/research.db`, read-only) | integrity | legacy-only database, 0 violations |
| Simulated code rollback (old schema push on a migrated copy) | rollback safety | push refused the data-loss statements without a terminal, applied nothing |

Mutation check: changing the private-visibility filter so other members' private items leak made the `dual_adaptive` privacy tests fail; the filter was restored.

## Automated tests (`tests/`)

- `unit/monitor-decision.test.ts`: silence and stall need connected members; edits count as progress; personal vs group confusion; confusion already answered by a peer; productive debate → `productive_progress`; unresolved vs resolved disagreement; imbalance names nobody; prompt-injection recognition; classifier fails safe (malformed output, unknown evidence ids, timeout, error, injected text withheld, not called when not allowed); decision engine: shadow-only in passive conditions, `proactive_group` never private, `dual_adaptive` private only for opted-in members, private limit without group fallback, every no-action reason code, explicit requests not blocked, cooldown expiry.
- `unit/research-config.test.ts`: release gate (no settings → V2 `dual_adaptive` home-page groups of 2–4; `ADAPTIVE_V2_ENABLED=false` → legacy and admin refused; `HOME_PAGE_GROUPS=legacy`; changed default condition; recorded versions; test-only policy flag; randomised allocation; feature normalisation); readiness (blockers, withdrawn, a group of one cannot start); device tokens; output validators; adaptive levels (hint, fading, no fading, level 2 only after level 1, never level 3).
- `integration/eligibility.test.ts`: consent needs every statement and is per person; nothing recorded before consent; start gate and idempotency; scenarios locked before start; no late join; roster and condition immutable (trigger); start route needs the token; withdrawal and drop-out; legacy groups unchanged.
- `integration/interventions.test.ts`: baseline shadow-only; `shared_on_demand` manual request (idempotent, group room, invalid type, rate limit); `proactive_group` offers (needs 2 online, offer without content, accept generates once, "Not now" personal, dismiss for all, never private); `dual_adaptive` privacy (private socket room only, SQL filter, API, impersonation 401, other member 404); "I'm stuck"; collapsed no-action logging; concurrent evaluations → one offer; debounce; after submission nothing is generated; without an API key support is template text recorded as `mock`; initial idea gate; sharing rules; legacy groups have no V2 API.
- `integration/legacy-exports.test.ts`: the 8 original export column lists equal the recorded fixture, for legacy and V2 groups.
- `integration/research-exports.test.ts`: every V2 export has provenance and only anonymous ids; the all-groups export has every V2 group and no legacy group; dashboard warnings (demo AI, test policy); admin group creation works by default and is refused when V2 is switched off; admin auth; integrity checker passes on platform data and catches a planted condition breach.

## V2 end-to-end pilot (`scripts/pilot-adaptive-v2.mjs`), actual output

```text
ok  a group created from the home page is a V2 dual_adaptive group without any settings
ok  researcher created group (dual_adaptive, policy-v2-test-accelerated)
ok  two members joined; each received a device token
ok  pre-test refused before the member's own consent
ok  consent refused when a statement is not confirmed
ok  one member cannot consent for another
ok  each member consented on their own and finished the pre-test
ok  scenarios stay locked until the group starts
ok  start gate passed; roster frozen at 2 members
ok  late join refused after the start
ok  scenario refused without the device token
ok  scenario loads with the device token
ok  socket join with another member's token denied
ok  both members connected to the scenario room
ok  proactive group offer (initial_silence -> participation_invitation) reached both members with its reason and no content
ok  B accepted; the support was generated once and delivered to the whole group (mock AI)
ok  A disconnected and reconnected; the delivered group support was reloaded from the database
ok  A opted in and said they were confused: private offer sent only to A (socket and API)
ok  B cannot read A's items by sending A's id
ok  B cannot accept A's private offer
ok  A accepted; private help delivered to A only
ok  B's "I'm stuck" gave a private level-1 offer; the retry was idempotent; A saw nothing
ok  manual shared facilitator request is visible to the whole group
ok  original private AI options still work in V2 groups (token required)
ok  reflection checkpoint broadcast to the group
ok  submitting the scenario expired the remaining open offer
ok  V2 exports: 4 interventions, 6 evaluation rows, 2 responses, demo AI flagged
ok  the all-V2-groups export contains both groups
ok  original exports still work for the V2 group; dashboard warns about demo AI text
Adaptive Scaffolding V2 pilot PASSED
```

This also verifies that API routes reach the Socket.IO server in the production build (shared through `globalThis`), which unit tests cannot show.

## Not run, and why

| Not run | Why | How to run it |
|---|---|---|
| Real AI provider (output quality, latency, validator rejections, token counts) | no API key in this workspace | set `OPENAI_API_KEY`, run a test group, accept a few offers; check `ai_origin = real` and `template_fallback` counts on the dashboard (delete the test group afterwards if it should not count) |
| Multi-browser manual session with people (UI flows, wording, timing) | needs humans and browsers | follow `06-researcher-operating-guide.md`, 2–4 people |
| All 10 scenarios in one V2 group | the automated pilots cover scenario 1 for V2 and scenarios 1–2 for the original flow | manual pilot |
| Railway deployment and its database | no access from this workspace | rollout steps in guide 06 |
| Lint of the whole repository (`npm run lint`) | the legacy `.teacher-docs-src/` and old scripts already have warnings; new and changed code lints clean | `npx eslint src server.ts tests` |
| Load and multi-replica behaviour | single replica is a hard requirement (in-memory rooms, presence, scheduler) | — |

## Known limitations

- Thresholds are default starting values, not validated; the optional model classifier is implemented but off and has only been tested with stubs.
- Human dialogue quality (uptake, evidence use) is not coded automatically; per-member active time is not exported.
- Recording a member as dropped out does not automatically submit a scenario if everyone else was already "good"; they must click "I am good" again.
- Admin **Delete group** deletes any group, V2 or legacy, with all its records (same as before V2).
- Without `OPENAI_API_KEY`, every V2 group still runs but receives template ("demo") text instead of real AI output; it is recorded as `mock` and shown as a dashboard warning, not blocked.
- The consent text is still the draft version and participants see it with a "Draft wording" note.
- `GET /api/sessions/[code]/sync` still returns no room state (pre-existing, unused by the client).
- Live room state, presence and the scheduler are in memory: a redeploy during a session resets live state (saved data is kept; clients reconnect and reload from the database).

## Adaptive private suggestions (`proactive_adaptive`, 2026-11-08)

All on throwaway databases with mock AI; `data/research.db` was only read (rehearsal copy).

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | pass |
| `npx eslint .` | 0 errors; 5 pre-existing warnings in `.teacher-docs-src/` and older scripts |
| `npm test` | **103 pass, 0 fail** |
| `npm run build` | pass |
| `npm run pilot:isolated` | original pilot (V2 off) and V2 pilot both pass; 0 integrity violations in either database |
| `npm run db:rehearse` | pass: 12 legacy tables unchanged; 15 tables added including `learner_models` and `learner_model_events` |

New tests:

- `unit/adaptive-learner.test.ts`: log-gamma and Student-t CDF against known values; seeded Beta sampling (reproducible, correct mean); the pre-test shifts only the independence prior; the same pause is long for a fast member and short for a slow one; burst merging of contributions; every reward and its weight; every fixed safety rule; a reluctant member is not offered help; "I'm unsure" skips the minimum pause; help chosen by sampled effectiveness, explanations only after light help, help already used not offered again; one draw per pause episode; a 2,000-case randomised check that a full answer or anything above level 2 is never offered.
- Simulation (same file): two members with identical priors and activity over 10 scenarios. The one who accepts and then contributes was offered `[0,0,2,1,2,2,2,2,2,2]` popups per scenario; the one who always chooses "No thanks" and rates support "too much" was offered `[1,0,0,0,0,0,0,0,0,0]`. Final receptiveness 0.96 vs 0.08, independence 0.42 vs 0.81; the decliner's help-effectiveness beliefs stayed at the priors because they never saw any help.
- `integration/adaptive-private.test.ts`: a popup goes only to the member whose model calls for it (socket room, API view, other member gets 404), connected members only, nothing generated before Yes and only once after; the decision is logged with its seed; rewards are applied once; help followed by the member's own contribution counts as success; "No thanks", "Not now" (closed, does not return, not expired at submission) and expiry each update the model; at most 2 per scenario; Step 2 use pauses popups and popups skip help already opened there; asking Step 2 for a full answer marks popup help as not enough; personal confusion is answered privately, not by a group prompt; the initial-idea gate applies; the survey requires the AI questions after popup help and its "About right" answer updates only that member; existing conditions never get popups or learner models; learner exports are anonymous, popup help never appears in the 8 original exports, and the integrity checker passes.
- V2 pilot over HTTP and Socket.IO: home-page groups are `proactive_adaptive`; no popups in a `proactive_group` group; in a `proactive_adaptive` group C says they are unsure and gets a private popup that D neither receives nor can answer, Yes delivers mock help once, the survey requires the support-amount question, and the popup, both learner models, the learner updates and the decision evidence are exported.

Fixed while testing: the survey stores "About right" as `appropriate`, which the first version of the learner ignored; the Step 2 recommendation lookup could have reused a popup decision row, so it now only reuses rows of its own engine version.
