# 01 — Existing system audit (before Adaptive Scaffolding V2)

Audited: `master` at commit `57195b9` ("Update assessments and collaborative scenarios"), package version `0.1.0`, working tree clean, 2026-11-07. This matches the baseline named in the handoff report, so no source drift had to be reconciled.

Local database `data/research.db` (git-ignored) holds 24 groups, all created by the pre-V2 code: 3 completed seeded demo groups (`GROUP-7HQM`, `GROUP-R4WK`, `GROUP-N8FJ`, from `scripts/seed-*.sql`) and 21 partial groups left by `npm run pilot:test` and manual testing. A backup was taken before any schema change: `data/backups/research-pre-v2-20261107-201756.db`. The Railway production database could not be inspected from this workspace; it must be treated as possibly containing **ongoing formal sessions** (see the release instructions in `06-researcher-operating-guide.md`).

## Verified baseline behavior (source references)

| Area | What the code does | Where |
|---|---|---|
| Runtime | Next.js 16.2.7 / React 19.2.4 behind a custom Node HTTP server with Socket.IO on `/socket.io`; binds `0.0.0.0` in production | `server.ts`, `package.json` |
| Persistence | Drizzle ORM + better-sqlite3, WAL, foreign keys on, lazily opened (`globalThis.__studyDb`); schema applied by `drizzle-kit push` before every start | `src/lib/db/index.ts`, `drizzle.config.ts`, `package.json` scripts |
| AI | OpenAI Responses API (`client.responses.create`, `store: false`, `max_output_tokens: 800`, `reasoning.effort: none` with fallback if unsupported); `OPENAI_MODEL` default `gpt-4o-mini`; optional `OPENAI_BASE_URL`; no key → deterministic mock text, model recorded as `mock` | `src/lib/ai/scaffold.ts`, `src/lib/prompts/index.ts` |
| Groups | Code `GROUP-XXXX`; `maxParticipants` 4 enforced at join; unique display name per group; **no minimum** — the lobby enables "Begin scenarios" when `participantCount >= 1` | `src/lib/services/sessions.ts#joinSession`, `src/app/session/[code]/page.tsx` (`canBegin`) |
| Consent | One boolean per **group** (`sessions.consent_given`). `POST /consent` takes no participant, so any visitor (even a non-member) can record consent for everyone | `src/app/api/sessions/[code]/consent/route.ts` |
| Identity / auth | The participant UUID in `localStorage` is the only credential; routes check that the UUID belongs to the session. No token, no socket authorization | all `src/app/api/sessions/[code]/*` routes, `src/lib/socket/index.ts` |
| Pre/post tests | 8 multiple-choice items scored 0–8 + 2 required open questions, one row per participant and type. `POST /assessment` does **not** verify membership | `src/data/assessment.json`, `src/lib/utils/assessment.ts`, `assessment/route.ts` |
| Start gate | Client-only: the lobby button checks this browser's consent + this browser's pre-test. Other members' pre-tests are not checked; the server never checks anything before scenarios | `session/[code]/page.tsx` |
| Scenarios | 10 data-driven scenarios; attempt row created lazily on first load (`discussionStartedAt` = first page load, not active discussion) | `src/data/scenarios.json`, `sessions.ts#getOrCreateAttempt` |
| Chat | Persisted via REST, relayed peer-to-peer by the **client** emitting `chat:message` | `messages/route.ts`, `useCollaboration.ts` |
| Shared answer | One `finalAnswer` field, last-write-wins full-field updates, per-character authorship runs, 500-word cap enforced client and server | `sync/route.ts`, `sessions.ts#updateAttemptFields`, `GroupAnswerEditor.tsx` |
| Readiness | "I am good" stored in `readyParticipantIds`; submission when **all currently registered members** are ready, inside a transaction. A late joiner changes the denominator | `sessions.ts#setParticipantReady` |
| Private AI | Nine selectable options (hint, guiding question, explanation, example, feedback, full answer, summary, task splitting, conflict support), multi-select, one cached response per participant × scenario × type (unique index), toggle counters, never shared | `src/lib/types.ts`, `scaffold/route.ts`, `ScaffoldingSelector.tsx` |
| Per-scenario instruments | Metacognition popup (confidence 1–5, why, do differently) then rating survey; AI-only items shown only if the student selected private support | `MetacognitionPrompt.tsx`, `SurveyForm.tsx`, `instruments.ts` |
| End | Post-test then 10 open end-questions | `session/[code]/complete/page.tsx` |
| Admin | Password (`ADMIN_PASSWORD`, dev default `research-admin`, none in production → disabled); list/delete groups; 8 per-group CSV exports; rubric 6 criteria × 1–4 (total 6–24) with blind mode | `src/app/admin/page.tsx`, `src/app/api/admin/*`, `src/lib/utils/export.ts`, `RubricScoring.tsx` |
| Real-time state | In-memory `roomState` map inside `src/lib/socket`; single replica required | `src/lib/socket/index.ts`, `README.md` |

## Differences from the handoff report

None that change the design. Two details the report does not mention:

1. `GET /api/sessions/[code]/sync` imports `getRoomState` from `@/lib/socket`. Route handlers are bundled by Next in a different module graph from `server.ts` (run by `tsx`), so that map is a different instance and the endpoint always returns `null`. It is unused by the client. V2 therefore shares the Socket.IO server and presence through `globalThis` instead of module state.
2. `POST /assessment` accepts any `participantId` (or none) without membership checks.

## Existing vs. proposed behavior

| Capability | Existing | V2 (new sessions only, opt-in by researcher) |
|---|---|---|
| Consent | Group boolean, anyone can set | Per participant, versioned consent + information sheet, withdrawal recorded, server-enforced before any participant data |
| Group size | 1–4 | Formal 2–4; 1 only in labelled pilot/demo mode |
| Start | Client-side check of own pre-test | Server transaction: every member consented and pre-tested, size within bounds, roster frozen |
| Late join | Allowed until 4 members, changes unanimous-readiness denominator | Rejected once scenarios start; readiness uses frozen roster |
| Auth | Bare UUID | Per-participant random token (hash stored), required for V2 sessions, optional for legacy |
| AI support | 9 private options | Unchanged + (by condition) shared facilitator on request, proactive group offers, opt-in private offers with fading |
| Records | `research_events` free-form log | Plus evaluation/decision/intervention/feedback tables incl. no-action decisions, versions and provenance |
| Exports | 8 CSVs | 8 CSVs unchanged + separate versioned V2 CSVs |

## Impact on instruments and data

- Scenario texts, pre/post items, survey items, end questions and rubric are **not modified**.
- Legacy sessions (every row without a `study_assignments` row) keep the original code paths: group consent, 1-member start, no token requirement, no V2 UI.
- New optional V2 instruments (initial idea, role cards, agreement reason) are **off by default**; turning them on is a protocol change.
- The neutral opening prompt and checkpoint cards are shown in **every V2 condition** (including V2 baseline), so V2 baseline differs from the legacy platform in those UI elements. Comparisons should be between V2 conditions, not legacy vs. V2.

## Ethics / protocol implications (human decisions, not code)

- Per-participant consent text, the AI-provider disclosure and withdrawal/contact wording need approval; the shipped text is a **draft** (`src/data/study-protocol.json`), and formal V2 groups cannot be created until `ADAPTIVE_V2_APPROVED_CONSENT_VERSION` matches it.
- Proactive group prompts send recorded chat and the shared answer (pseudonymised) to the configured AI provider only after a member accepts an offer; shadow monitoring in passive conditions is rule-based and sends nothing.
- Allocation (fixed vs. randomised), which conditions are compared, thresholds, and the optional instruments all need supervisor sign-off.

## Blocking unknowns

- Whether Railway currently hosts ongoing formal sessions (cannot be checked from here). Mitigation: V2 is additive and off by default; legacy sessions are untouched.
- Approved consent wording, contact details and retention period.
- Real-provider verification (no API key in this workspace; all AI in tests runs in mock mode and is labelled as such).
