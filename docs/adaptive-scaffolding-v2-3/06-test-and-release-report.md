# 06: Test and release report (V2.3)

Everything below was run in this workspace on 2026-11-09 against the uncommitted working tree of `feature/adaptive-v2-3-learning-aware`. Nothing was deployed.

## Results

| Command | Result |
|---|---|
| `npm test` (each test file gets its own temporary database) | 160 tests, 160 pass, 0 fail (baseline was 105; added 2 in `research-config`, 40 in `tests/unit/learning-aware.test.ts`, 13 in `tests/integration/learning-aware.test.ts`) |
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run lint` | 0 errors; 5 warnings, all in files not touched by this work (`.teacher-docs-src/` ×3, `scripts/generate-dissertation-docx.mjs`, `scripts/pilot-test.mjs`) |
| `npm run build` | success; new routes `/api/admin/v2-3/open-rubric`, `/api/admin/v2-3/review`, `/api/sessions/[code]/interventions/[id]/exposure`, `/api/sessions/[code]/interventions/[id]/progress` |
| `npm run pilot:isolated` (production server, throwaway DB, mock AI) | PASSED: legacy pilot plus V2 pilot, including the new V2.3 group (details below); integrity check 0 violations, 2 expected warnings (`test_policy`, `mock_ai_output`) |
| `npm run db:verify` (read-only on `data/research.db`) | "No Adaptive Scaffolding V2 tables: legacy-only database." 0 violations, 0 warnings |
| `npm run db:rehearse` (backup copy of `data/research.db` in a temp dir) | passed: 12 existing tables unchanged; 23 tables added (15 V2 + 8 V2.3); column `participants.auth_token_hash` added (NULL for all 44 members); integrity 0 violations, 1 expected warning (immutability trigger is created at app start) |

**Isolated pilot, V2.3 section.** This runs over real HTTP and Socket.IO with group policy `policy-v2-3-test-accelerated`, condition `proactive_adaptive`:

- A shared prompt appeared after the initial silence. Both clients reported `socket_delivered`, and member C's display was recorded once (the replay was ignored).
- C dismissed the prompt. It stayed open for member D, whose state shows `dismissal: per_member`.
- C wrote "I'm confused…" and received a minimal private popup whose explanation mentions the stop option.
- D did not receive the popup. D's attempt to report exposure on it returned 404.
- C saw and accepted the popup and answered "Partly". C's second answer was a duplicate, and D's attempt to answer returned 404.
- C's state shows the answer; D's state contains nothing about C's popup.
- C chose "Don't suggest again in this scenario". The stop applies to C only.
- V2.3 exports produced 3 group states, 8 private decisions and 9 exposures, with anonymous IDs only. The funnel has 2 rows for the shared prompt (dismissed / none). The dashboard has its V2.3 section.

A first pilot attempt failed because the V2.3 section waited for a group prompt without loading the scenario first. Loading the scenario creates the scenario attempt, so the scheduler had nothing to evaluate. The pilot now loads the scenario for both members, as the real client does. This was a defect in the pilot script, not in the product.

## Research instrument hashes (unchanged)

| File | Baseline SHA-256 | Final SHA-256 |
|---|---|---|
| `src/data/assessment.json` | `C119297D31C8536C9E0C8F6D1EE9AB1F4B91198D1CA923B8481B5404AE08B9FA` | `C119297D31C8536C9E0C8F6D1EE9AB1F4B91198D1CA923B8481B5404AE08B9FA` |
| `src/data/scenarios.json` | `49035E72F8EC39C88AF4EAEBCE13F17C3D05108B9175BEFCE7F7E3A14527ECBA` | `49035E72F8EC39C88AF4EAEBCE13F17C3D05108B9175BEFCE7F7E3A14527ECBA` |

- `git status` shows both files unmodified.
- The stored versions `assessment-sha256-6c3f9d24a87a` and `scenarios-sha256-3fdfbc884c7a` (SHA-256 of the parsed JSON) are unchanged.
- The unit tests under "Instrument freeze" assert:
  - both canonical content hashes and the stored version prefixes
  - the 8 scenarios in order (`scenario-01` … `scenario-08`)
  - `pre-1` … `pre-8` and `post-1` … `post-8`
  - the identical written question `open_ai_role` before and after
  - `ANSWER_WORD_LIMIT = 500`

`data/research.db`:

- SHA-256 `F9DE91FC91731FCCE3F7E2C749FD63B72410A30F785A7C79A38A6E47354AAF00`, 729,088 bytes, last written 2026-11-04 22:17:19.
- Identical before and after `db:verify` and `db:rehearse`.
- No temporary copies remain.

## Policy registry check

Compared with `master`, `policy-v2-1`, `policy-v2-2` and `policy-v2-test-accelerated` are identical (parsed JSON). The changes are the two added versions, `policy-v2-3` and `policy-v2-3-test-accelerated`, and `current` moving from `policy-v2-2` to `policy-v2-3`.

## Required scenario matrix (master prompt section 11)

"Covered" means an automated test asserts it. "Partial" means the behaviour is implemented but the test only covers part of it.

| # | Scenario | Status | Where |
|---|---|---|---|
| 1 | Constructive disagreement → silent | covered | unit "disagreement that keeps adding new reasons…", "productive disagreement leads to no action"; integration trace 1 |
| 2 | Repeated arguments → shared comparison prompt | covered | unit "same positions repeated…", "a repetition loop leads to a shared disagreement prompt" |
| 3 | "Thinking" → no help on silence alone | covered | unit "a recent 'let me think'…", "a long pause alone is not a need", "…self-reported progress all keep the popup away" |
| 4 | Explicit confusion → minimal private opt-in, never posted to group | covered | integration trace 3 |
| 5 | Distinct histories → different offers, no leakage | covered | integration trace 3 (A offered, B waits), exports and privacy test |
| 6 | Activity within the window → understanding `not_assessed` | covered | unit outcome evaluator, reward "observed outcomes count at half weight…" |
| 7 | Slow but later reasoned → no false failure | partial | by design, absence of activity changes only the engagement channel; unit "submission truncates the window; nothing observed stays unknown" |
| 8 | Escalation after hint → recorded, no automatic failure label | covered | integration trace 3, unit scaffolding tests |
| 9 | Not needed / stop → respected; Step 2 still available | covered / partial | integration stop test; Step 2 is not blocked by the decision code (no dedicated V2.3 Step 2 test) |
| 10 | Missing / expired unseen → no negative update | covered | integration "a popup that expires unseen…", unit "missing data is missing" |
| 11 | Fading after independent progress; re-evaluation possible | covered | integration trace 4, unit scaffolding |
| 12 | Offer while scrolled away → indicator; delivered vs visible vs accepted | partial | indicator UI plus exposure routes tested; no browser test of scrolling |
| 13 | Member dismisses for themself only | covered | integration per-member dismissal; pilot |
| 14 | Simultaneous accept → one generation | covered | existing V2 integration tests (unchanged, passing) |
| 15 | Fetching another's private help or state rejected | covered | integration exposure / progress / stop routes, exports test, pilot |
| 16 | Mock / fallback / test policy flagged | covered | existing V2 tests, integrity checker, pilot |
| 17 | Restart / reconnect → durable state | partial | V2 reconnect pilot; V2.3 state is in the database (no restart test specific to V2.3) |
| 18 | Shadow logging in passive conditions | partial | existing V2 shadow tests; V2.3 estimator runs deterministically in shadow (no V2.3-specific test) |
| 19 | Old policy keeps behaviour; new groups on `policy-v2-3` | covered | unit "policies without learningAware ignore any estimate", integration "groups on older policies…", `research-config` |
| 20 | Withdrawn / dropped-out member | partial | existing V2 eligibility tests; V2.3 routes use the same server-side authorization, and outcome feedback counts only active members |
| 21 | Classifier failure / timeout → deterministic fallback | covered | unit "a timeout or invalid output keeps the deterministic estimate" |
| 22 | Rapid polling → idempotent, bounded cost | covered | seeded decisions plus idempotency key (integration expiry test: `already_offered_for_this_evidence`); classifier rate limit and "clear situations are not sent to the model" |
| 23 | Evidence and provenance recorded for offers and no-action | covered | integration trace 1 (estimate linked to evaluation), exports test |
| 24 | Malicious timestamps / IDs / forged exposure | covered | integration exposure route test (401/403/404/400/409/429, client clock rejection, replay) |
| 25 | Instruments identical | covered | unit "Instrument freeze", file hashes above |
| 26 | Step 2, manual actions, 500 words, exports, rubric, integrity still work | covered | the 105 baseline tests (unchanged, passing), legacy export columns test, pilots |
| 27 | Accessibility of indicator and feedback | partial | `role="status"`/`aria-live`, labelled `role="group"`, keyboard buttons, focus moved to the card; no automated accessibility test |
| 28 | Compare trigger labels with blinded human coding | partial | review sampling, labels and agreement tested with a synthetic fixture; real comparison needs human-coded data |

**Negative cases:**

- invalid AI JSON and timeouts (classifier unit test)
- no AI key: the classifier never runs, and demo text is flagged as `mock`
- authorization (route tests)
- pseudonymization (classifier input, review windows, exports)
- the migration rehearsal
- concurrency: existing atomic transitions, and the unique keys on all V2.3 tables

## Limitations

- No browser end-to-end or automated accessibility test was run for the new indicator and feedback controls. They were checked through their contracts (exposure routes) and the pilot.
- The researcher labelling and rubric entry exist as admin API endpoints only. `/admin` shows the V2.3 dashboard and agreement statistics but has no labelling form.
- The thresholds in `policy-v2-3` are starting values carried over from `policy-v2-2`, plus new estimator settings. None is a validated scientific threshold.
- The estimator is rule-based and English-oriented (keyword and token patterns). Its accuracy is unknown until human-coded comparison data exists.
- The existing V2 export `v2_recommendations.evidence_json` contains the decision seed, which starts with the internal participant ID. This is pre-existing V2 behaviour and was left unchanged, because existing exports must not change. The new `v2_3_private_decisions` export pseudonymizes the seed.

## Changes that need ethics / researcher approval before formal data collection

1. The consent document is still `consent-v2-draft-1`, with a placeholder researcher contact and unapproved retention wording. This blocks new formal human data collection. It was not changed or approved automatically.
2. New participant-facing wording:
   - "The group facilitator has a suggestion for your group." ("Show me" / "Hide")
   - "If one member opens it, everyone sees it. Dismissing it only hides it for you."
   - "Did this help you make progress? (optional, one click)" with Yes / Partly / No / I didn't need it / Skip
   - "Don't suggest again in this scenario"
   - the popup explanation ("Only you can see this, and nothing is sent to the AI unless you click Yes. It starts with the smallest useful help and will not give you the answer. You can choose "Don't suggest again in this scenario" at any time; your own Step 2 help stays available.")
3. New data collected:
   - per-member exposure (displayed on screen, opened)
   - one-click feedback
   - scaffolding state
   - private decision traces
   The protocol and information sheet should disclose these (the study protocol version is a researcher decision).
4. The policy change for new groups (`policy-v2-3`): confirm the starting values, or pin `policy-v2-2` for a running cohort.
5. The optional human-review protocol and the optional open-answer rubric. Both are off or unused unless the researcher enables them, and both need methodological approval.

## Safe deployment steps (for a human reviewer; nothing was deployed)

### Step 0: decide and prepare (no participant impact)

1. If any cohort is currently collecting data under `policy-v2-2`, set `ADAPTIVE_V2_POLICY_VERSION=policy-v2-2` on the service **before** deploying. New groups then stay on `policy-v2-2` until the researcher removes the variable.
2. Confirm on `/admin` that no group is mid-session.
3. Back up the production database on the volume (service shell):
   ```bash
   node -e "require('better-sqlite3')('/data/research.db',{readonly:true}).backup('/data/research-pre-v2-3-'+new Date().toISOString().slice(0,10)+'.db').then(()=>console.log('backup done'))"
   ```
4. Download the backup, then locally:
   ```powershell
   npm ci
   npm test
   npx tsc --noEmit -p .
   npm run lint
   npm run build
   npm run pilot:isolated
   npm run db:rehearse -- path\to\research-pre-v2-3-YYYY-MM-DD.db
   npm run db:verify -- path\to\research-pre-v2-3-YYYY-MM-DD.db
   Get-FileHash src\data\assessment.json, src\data\scenarios.json -Algorithm SHA256
   ```
   The hashes must equal the values above.
5. Commit the branch, open a pull request, have it reviewed, then merge.

### Step 1: deploy (researcher action)

1. Keep `ADAPTIVE_V2_ALLOW_TEST_POLICY` and `ADAPTIVE_V2_OPEN_ANSWER_RUBRIC` unset. Keep `ADAPTIVE_V2_DEFAULT_CONDITION` unset or `proactive_adaptive`, and `ADAPTIVE_V2_ASSIGNMENT` unset or `fixed`. Set `OPENAI_API_KEY`; otherwise groups get flagged demo text.
2. Deploy. `npm run start:prod` runs the additive `drizzle-kit push`.
3. In the service shell:
   ```bash
   npm run db:verify -- /data/research.db
   npm run db:inspect
   ```
   Expect `0 violation check(s) failed`.
4. On `/admin`: create a test group. It should show `proactive_adaptive` and `policy-v2-3`, or the pinned policy. Existing groups must show their original policy.

### Rollback

- **Preferred:** set `ADAPTIVE_V2_POLICY_VERSION=policy-v2-2`. New groups use V2 behaviour, while groups already on `policy-v2-3` keep their immutable policy and continue to work.
- **Code rollback to `master`:** only safe while **no** `policy-v2-3` group exists. Older code does not know `policy-v2-3` and would refuse to evaluate such groups (`Unknown intervention policy version`). The 8 additional tables would simply be unused. Never run `drizzle-kit push --force` with an older schema, because it would drop V2.3 data.
- Restore the Step 0 backup only if data was damaged.
