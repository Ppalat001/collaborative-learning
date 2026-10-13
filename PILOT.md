# Pilot Testing Guide

Use this checklist before running your full dissertation study.

## Pre-pilot setup

- [ ] PostgreSQL running (`docker compose up -d`)
- [ ] Schema pushed (`npm run db:push`)
- [ ] `.env` configured (OpenAI key optional for first pilot)
- [ ] App running (`npm run dev`)
- [ ] Automated smoke test passes (`npm run pilot:test`)

## Pilot session protocol (1–2 groups)

### Before students arrive

1. Create a session from the home page
2. Note the room code (e.g. `GROUP-A7X2`)
3. Open `/admin` and confirm you can export (may be empty initially)
4. Prepare observation notes: collaboration quality, scaffolding choices, UX friction

### With students (2–4 per group)

1. Each student opens the app on their own device (laptop, tablet, or phone)
2. Students join with the room code and a nickname
3. Read the consent text aloud; one member checks the box and records consent
4. Each member completes the **pre-test** individually in the lobby
5. Begin Scenario 1 together
5. Observe:
   - Do all members see discussion text update in real time?
   - Does the group understand they must choose scaffolding before submitting?
   - Does the AI response match the scaffolding type chosen?
   - Is the final answer truly a group product?

### After each scenario

- Confirm **every** student submitted their own rating (not only the one who submitted the answer)
- Check that data appears in CSV export

## What to tune after pilot

| Issue | Action |
|-------|--------|
| AI gives full answers on "hint" or "guiding question" | Tighten prompts in `src/lib/prompts/index.ts` |
| Groups confused by flow | Add facilitator verbal instructions; simplify lobby text |
| Sync lag on phones | Verify WebSocket connects; check network |
| Discussion too short | Allow more time; scenarios are ~6–10 min each |
| "Full answer" overused | Discuss with group beforehand; note in analysis |

## Automated validation

```bash
npm run pilot:test
```

Expected output: `Pilot test PASSED`

This validates: session creation, join, consent, group chat (names, colours, before/after AI split), scaffolding, final answer, survey, and CSV export.

## Data to verify in export

After a pilot group completes at least one scenario, export CSV and confirm:

- `session_code` matches room code
- `scaffolding_type` and `help_reason` match what the group chose
- `discussion_before_ai` contains the chat up to the AI request, and `final_answer` is populated
- The chat log export shows every message, with `sent_before_ai` set to yes or no
- `time_before_ai_seconds` is calculated
- The ratings export has one row per student per scenario
- The contributions export shows every student, including those who typed nothing
- Delete `data/research.db` after piloting so test sessions don't mix with study data

## Recommended pilot sample

- **Group 1:** 2 members, complete Scenarios 1–3
- **Group 2:** 3–4 members, complete Scenarios 1–5

This validates both small and full group sizes without running all 10 scenarios twice.

## Ethics reminder

- Use nicknames only (no full names required)
- Explain AI logging to participants
- Store exports securely
- Set `ADMIN_PASSWORD` to something strong before study deployment
