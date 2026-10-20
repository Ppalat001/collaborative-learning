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

1. Open the app and `/admin` and confirm you can log in (don't create the session yourself: whoever creates it joins as a group member)
2. Prepare observation notes: collaboration quality, scaffolding choices, UX friction

### With students (2–4 per group)

1. Each student opens the app on their own device (laptop, tablet, or phone)
2. One student enters their name and clicks **Create session**; the lobby shows the group ID (e.g. `GROUP-A7X2`) with a copy button. The others join with that group ID and their own name (a name is required and must be unique within the group)
3. Read the consent text aloud; one member checks the box and records consent
4. Each member completes the **pre-test** individually in the lobby
5. Begin Scenario 1 together
5. Observe:
   - Do all members see the chat and the shared answer update in real time, in each person's colour?
   - Do students understand that Step 2 AI support is private and that they can select and unselect options?
   - Does the AI response match the option chosen?
   - Do students understand they must all click "I am good" to move on?
   - Is the final answer truly a group product (check the colours and the share shown in the name bar)?

### After each scenario

- Confirm **every** student submitted their own rating
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

This validates: session creation, join, consent, group chat (names, colours, before/after AI split), private multi-select AI support with stored responses, the shared answer with authorship and the 500-word limit, "I am good" readiness, surveys and CSV export.

## Data to verify in export

After a pilot group completes at least one scenario, choose the group in `/admin`, export the CSVs and confirm:

- `group` matches the room code and `group_members` lists the nicknames
- `ai_help_used_by_each_student` matches what each student selected
- The AI support export has one row per student and option, with `times_shown` and `times_hidden`
- The chat log shows every message with the student name and `before AI` / `after AI`
- `answer_written_by` and `share_of_final_answer_percent` roughly match the colours you saw
- The ratings export has one row per student per scenario
- The pre/post comparison has one row per student with both scores and both written answers
- Delete the pilot groups from `/admin` (or delete `data/research.db` locally) so test sessions don't mix with study data

## Recommended pilot sample

- **Group 1:** 2 members, complete Scenarios 1–3
- **Group 2:** 3–4 members, complete Scenarios 1–5

This validates both small and full group sizes without running all 10 scenarios twice.

## Ethics reminder

- Use nicknames only (no full names required)
- Explain AI logging to participants
- Store exports securely
- Set `ADMIN_PASSWORD` to something strong before study deployment
