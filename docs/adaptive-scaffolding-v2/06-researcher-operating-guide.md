# 06 — Researcher operating guide and release instructions

## Settings

V2 is **on by default**. With no `ADAPTIVE_V2_*` variable set, every new group — created from the home page or on `/admin` — is a V2 group, and home-page groups get the `dual_adaptive` condition. All V2 groups are handled the same way (there are no separate study modes). Settings only affect groups **created after** they change; an existing group never changes condition or policy, and groups created before V2 (legacy groups) keep working as before.

| Variable | Default | Effect |
|---|---|---|
| `ADAPTIVE_V2_ENABLED` | on | `false` switches V2 off: every new group is a legacy group again, and `/admin` refuses to create V2 groups |
| `ADAPTIVE_V2_HOME_PAGE_GROUPS` | `v2` | `legacy`: home-page groups are legacy groups, while `/admin` can still create V2 groups |
| `ADAPTIVE_V2_DEFAULT_CONDITION` | `dual_adaptive` | condition for home-page groups with fixed allocation |
| `ADAPTIVE_V2_ASSIGNMENT` | `fixed` | `randomized`: home-page/admin groups without a chosen condition draw from the list below |
| `ADAPTIVE_V2_RANDOMIZE_CONDITIONS` | empty | comma list, e.g. `baseline_private_request,proactive_group` |
| `ADAPTIVE_V2_ALLOW_TEST_POLICY` | off | allows `policy-v2-test-accelerated` (seconds-scale timing, automated tests only). Leave off in production |
| `ADAPTIVE_V2_SCHEDULER_MS` | `5000` | how often connected V2 scenario rooms are re-evaluated |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | as before | set a key for real groups; without one, AI support is template ("demo") text, recorded as `ai_origin = mock` and shown as a warning on the dashboard |
| `ADMIN_PASSWORD`, `DATABASE_URL` | as before | unchanged |

Group size for V2 groups is 2–4 members (`groupSize` in `src/data/study-protocol.json`).

## Rules that keep existing study sessions unchanged

1. Groups without a `study_assignments` row (all groups created before V2, and groups created while V2 is switched off or home-page groups are set to `legacy`) always use the original code paths: group consent, no tokens, no V2 panels, original readiness.
2. Assignments are written once and protected by a database trigger; no setting or API changes them.
3. **Never edit an existing policy version** in `src/data/intervention-policies.json` or the consent text of an existing version in `study-protocol.json`. Add a new version instead. Groups keep the version they were created with. If a consent version is removed while a group created with it still has members to consent, those members get "consent text no longer available".
4. Change variables and redeploy only when no group is mid-session: a restart resets live room state (saved data is kept, clients reconnect).
5. Keep **1 replica** (in-memory rooms, presence and scheduler).

## Before the first real group

1. **Consent text.** `src/data/study-protocol.json` still contains draft consent wording (`consent-v2-draft-1`) with a contact placeholder, and participants see a "Draft wording" note while the protocol `status` starts with `DRAFT`. Put the final text under a **new** `consent.version` (and information sheet version), replace the contact placeholder, change `status` so it no longer starts with `DRAFT`, then commit and deploy.
2. **AI key.** Set `OPENAI_API_KEY` (and pin `OPENAI_MODEL`) on Railway. Without it, groups run with demo text.

## Railway rollout

### Step 0: before deploying (no participant impact)

1. On `/admin`, load the groups and make sure no group is in the middle of a session at deployment time.
2. Back up the database on the volume. Open a shell on the service (`railway ssh` or the dashboard's shell) and run:
   ```bash
   node -e "require('better-sqlite3')('/data/research.db',{readonly:true}).backup('/data/research-pre-v2-'+new Date().toISOString().slice(0,10)+'.db').then(()=>console.log('backup done'))"
   ```
   Keep the file until the rollout is verified (optionally download it).
3. Locally, `npm test`, `npm run build` and `npm run pilot:isolated` must pass on the commit you deploy. If you downloaded the backup, also run `npm run db:rehearse path/to/backup.db`.

### Step 1: deploy

1. No `ADAPTIVE_V2_*` variable is needed. Set `OPENAI_API_KEY` if it is not set yet. Do not set `ADAPTIVE_V2_ALLOW_TEST_POLICY`.
2. Deploy the commit. `npm run start:prod` runs the additive `drizzle-kit push`; the deploy log should show `[✓] Changes applied` and then `> Ready on http://0.0.0.0:<port>`.
3. Verify in the service shell:
   ```bash
   npm run db:verify -- /data/research.db
   npm run db:inspect
   ```
   Expected: `Groups: N legacy, 0 V2 (...)` and `0 violation check(s) failed`.
4. Create a group from the home page: it now opens the V2 lobby (per-person consent and pre-test), and on `/admin` it is listed as `(V2: dual_adaptive)`. The V2 section on `/admin` shows `AI provider: real (OpenAI)` when the key is set.
5. Existing legacy groups continue exactly as before.

### Step 2: first groups

Run a first session yourself or with colleagues and check the dashboard: AI origin `real`, no failures, few template fallbacks. Test groups you do not want in your results can be deleted on `/admin` (*Clean up data*) after downloading anything you need.

### Rollback

- Set `ADAPTIVE_V2_ENABLED=false` and redeploy: new groups are legacy again; existing V2 groups keep their records and can still be exported.
- A code rollback to the pre-V2 commit keeps the V2 tables (tested: the old schema push refuses to drop them without a terminal and applies nothing). Never run `drizzle-kit push --force` with the old schema.
- Restore the Step 0 backup only if data was damaged (it loses everything recorded after the backup).

## Running a V2 session

1. **Create the group:** either members create it from the home page (condition `dual_adaptive` by default), or you create it on `/admin` → *Adaptive Scaffolding V2* → condition, policy and instrument settings → *Create group*, and give the code to the participants.
2. **Lobby:** each member joins with the code on their own device and gets a device token (stored in that browser). Each member reads the consent form and ticks every statement, then completes the pre-test. The lobby lists who has consented and finished the pre-test. *Begin scenarios* works only when everyone is ready and the group has 2–4 members. Starting freezes the roster; nobody can join afterwards.
3. **Scenarios:** the original Step 1–3 flow, plus, depending on the condition: the shared group facilitator panel (requests and proactive offers, with *View/accept*, *Not now*, *Dismiss* and *Why this suggestion?*), the optional private suggestions switch and *I'm stuck* (`dual_adaptive`), and *Share with group* for private AI ideas.
4. **If a member leaves for good:** on the dashboard, choose the member and *Mark as dropped out*. The remaining members can finish; if all of them had already clicked *I am good*, they click it once more.
5. **Withdrawal:** a member clicks *Withdraw my consent* in the lobby. Nothing more is recorded for them; earlier data is kept until you act according to the approved protocol.

## Monitoring and explaining an intervention

On `/admin`, choose a V2 group:

- **Warnings:** members without consent, demo AI text (no API key), the test-only policy, solo groups, template fallbacks, failures, items the condition should not allow.
- **Versions and flags:** policy, protocol, consent, model at creation, AI mode, assignment method, data-quality flags.
- **Counts:** evaluations (weighted by repeats), decisions, reason codes, triggers, interventions by status and scope, AI origin, member responses, shares and recommendations.
- **Timeline:** each evaluation and intervention in time order, with trigger, decision, reason and target. Together with `v2_evaluations` → `v2_interventions` (via `evaluation_id`) → `v2_feedback` (via `intervention_id`) and the original chat log, this answers **when** (timestamps), **why** (trigger, evidence, reason code and explanation), **how** (support type, level, content, AI origin and model) and **to whom** (scope and anonymous recipient) the AI intervened, and how members responded.

## Exporting

- Original 8 exports: unchanged, one group at a time.
- V2 exports: one group, or **all V2 groups** in one file (`?scope=all`). Every row names its group and condition; legacy groups are never included. Check the `data_quality_flags` column (`mock_ai_output`, `test_policy`, `not_started`, …) before analysis.
- V2 exports contain only anonymous `student_id`s. The original exports contain nicknames; keep the linkage files restricted.

## Local commands

| Command | Purpose |
|---|---|
| `npm test` | unit + integration tests on a disposable database |
| `npm run pilot:isolated` | production server on a throwaway database: the original pilot with V2 switched off, and the V2 pilot with default settings (needs `npm run build` first) |
| `npm run pilot:test` / `npm run pilot:v2` | the pilots against an already running server (writes into that server's database). `pilot:test` needs `ADAPTIVE_V2_ENABLED=false`; `pilot:v2` needs `ADAPTIVE_V2_ALLOW_TEST_POLICY=true` |
| `npm run db:rehearse [file]` | rehearse the schema push on a copy; source untouched |
| `npm run db:verify [file]` | read-only integrity check |
| `npm run db:inspect` | list groups with their condition |
