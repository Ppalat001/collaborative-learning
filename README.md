# Collaborative AI Learning System

Responsive web application for dissertation research on AI-supported collaborative learning. Groups of 2–4 students work through structured scenarios, choose scaffolding types, receive constrained AI support, and submit joint answers.

## Features

- Group sessions with shareable room codes (`GROUP-XXXX`)
- 10 structured learning scenarios
- Real-time shared discussion via WebSocket (Socket.io)
- 10 scaffolding types with prompt-constrained AI responses
- PostgreSQL logging of all research events
- CSV export for statistical analysis
- Post-scenario survey (autonomy, satisfaction, collaboration, helpfulness)
- Mock AI mode when `OPENAI_API_KEY` is not set

## Quick start

### 1. Start the database

SQLite is used by default (no Docker required). The database file is created automatically at `./data/research.db` when you run:

```bash
npm run db:push
```

For production, you can switch to PostgreSQL by updating `DATABASE_URL` and using `docker compose up -d` with the included PostgreSQL config.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your `OPENAI_API_KEY` when ready for live AI responses.

### 3. Push database schema

```bash
npm run db:push
```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Study flow

1. The first student enters their name and clicks **Create session**; the lobby shows the group ID to share
2. The other students (2–4 in total) join with the group ID and their own name; a name is required and must be unique within the group
3. Group records informed consent in the lobby (in V2 groups each member consents on their own device, and the scenarios start only when every member has consented and finished the pre-test)
4. Each participant completes the **pre-test** individually (no Skype, Zoom or other external calls; tests are individual)
5. For each scenario:
   - Read the task
   - Discuss together in a live group chat (each message shows the student's name, time and their own colour, and is logged under their anonymous ID)
   - **Individual AI support (Step 2):** each student privately selects any number of AI options (or none). Each option's response is generated once per student and stored; unselecting hides it and selecting it again shows the same response without a new AI call. Other members never see it
   - **Final group answer (Step 3):** everyone types in one shared box (max 500 words). Each student's text is highlighted in their own colour, and a bar above the answer lists every member with their colour, share of the text and status
   - Each student clicks **I am good** when happy (this pauses their typing; clicking again unselects it). The scenario finishes only when **every** member is marked good
   - Each student then answers two **metacognitive prompts** (confidence in the group answer and what the group could have done differently), then the scenario rating on their own device
6. Each participant completes the **post-test** and short end-of-study open questions
7. Researcher scores the final answers with the rubric and exports CSVs from `/admin`

## Research data export

Visit `/admin`, enter the admin password (`ADMIN_PASSWORD`; locally defaults to `research-admin`, required in production), click **Load groups** and choose a group. Every export is for one group (`/api/admin/export?type=…&session=GROUP-XXXX`; without `session` it is rejected). Students are shown by nickname plus their anonymous `student_id`, times are UTC, and percentages are 0–100.

| Export | One row per |
|---|---|
| Group answers per scenario | scenario (members, final answer, who wrote what share, AI help each student used, highest AI level, % of the answer copied from AI, chat before/after AI, minutes, rubric total, mean confidence) |
| Discussion chat log | chat message (student, time, before or after the group's first AI request) |
| Individual AI support | student × scenario × AI option (level, times shown/hidden, the AI reply) |
| Individual contributions | student × scenario (chat messages and words, characters typed, share of the final answer) |
| Individual scenario ratings | student × scenario (confidence in the answer and why, what the group could do differently, 1–5 ratings, amount of AI help, comment) |
| Pre/post-test comparison | student (pre and post score, each concept and the two written answers side by side) |
| End questionnaire | student (answers to the questions after the post-test) |
| Rubric scores | scenario × rater (6 criteria scored 1–4, total 6–24, average) |

### Cleaning the database

On `/admin` after loading the groups, **Delete group** removes the chosen group and everything recorded for it (type its code to confirm), and **Delete all groups** empties the study data (type `DELETE ALL`). Locally you can instead stop the server and delete `data/research.db`, `data/research.db-wal` and `data/research.db-shm`; the next `npm run dev` creates a fresh database.

Research instruments (survey items, end-of-study questions, rubric criteria) are defined in `src/lib/instruments.ts`.

## Adaptive Scaffolding V2

The current version of the platform for new groups: per-person consent, a server-side start gate with a frozen roster (2–4 members), a shared AI group facilitator (on request and, by condition, proactive offers that members accept or dismiss), and logging of every decision including decisions not to intervene. Step 2 contains six private answer-support options; collaboration/process support is provided only through the shared group facilitator.

It is **on by default**: with no `ADAPTIVE_V2_*` variables, every new group (home page and `/admin`) is a V2 group in the `proactive_group` condition. The separate private AI coach, opt-in switch and "I'm stuck" request are removed; private support remains available through the six Step 2 choices. The retired `dual_adaptive` condition remains readable only for groups that were assigned it previously, but it no longer enables private offers and cannot be assigned to new groups. Groups created before V2 (legacy groups) never change and keep working as before. Researchers can also create V2 groups with a chosen current condition on `/admin`, where a dashboard shows each group's decisions, interventions, responses and warnings, and separate versioned V2 CSV exports (per group or all V2 groups) are available. `ADAPTIVE_V2_ENABLED=false` switches back to the original platform for new groups.

Documentation: [`docs/adaptive-scaffolding-v2/`](./docs/adaptive-scaffolding-v2/) (audit, plan, research protocol and measures, data dictionary and migrations, test report, researcher operating guide with Railway rollout, status). Settings are listed in `.env.example`.

## Testing

```bash
npm test                 # unit + integration tests on a disposable SQLite database
npm run build
npm run pilot:isolated   # production server on a throwaway database: original pilot (V2 switched off) + V2 pilot (defaults)
npm run db:rehearse      # rehearse the schema push on a copy of data/research.db (source untouched)
npm run db:verify        # read-only research-integrity check
```

`npm run pilot:test` (original flow; needs a server started with `ADAPTIVE_V2_ENABLED=false`) and `npm run pilot:v2` (needs `ADAPTIVE_V2_ALLOW_TEST_POLICY=true`) run against an already running server and write into its database.

See [PILOT.md](./PILOT.md) for a full pilot checklist with real student groups.

## Tech stack

- Next.js 16 + React + TypeScript + Tailwind CSS
- Socket.io for real-time collaboration
- PostgreSQL + Drizzle ORM
- OpenAI API (optional)

## Project structure

```
src/
├── app/              # Pages and API routes
├── components/       # UI components
├── data/             # Scenario content (JSON)
├── hooks/            # Real-time collaboration hook
└── lib/
    ├── ai/           # Scaffolding agent
    ├── db/           # Database schema
    ├── prompts/      # Scaffolding prompt templates
    └── services/     # Session business logic
server.ts             # Custom server with WebSocket support
```

## Deployment (Railway)

The app needs a long-running Node process (for Socket.io) and a persistent disk (for SQLite), so serverless hosts like Vercel or Netlify will not work. `railway.json` configures the build (`npm run build`) and start (`npm run start:prod`) commands.

1. Push the repo to GitHub, then in Railway: **New Project → Deploy from GitHub repo**.
2. Add a **Volume** to the service, mounted at `/data`.
3. Set **Variables**:
   - `DATABASE_URL=file:/data/research.db`
   - `ADMIN_PASSWORD=<strong password>` (admin exports are disabled in production without it)
   - `OPENAI_API_KEY=<key>` (without it, AI support is demo text, recorded as mock)
   - `OPENAI_MODEL=<model>` (optional; defaults to `gpt-4o-mini`)
   - `OPENAI_BASE_URL=<url>` (optional; for OpenAI-compatible providers such as OpenRouter or Groq)
4. **Settings → Networking**: generate a Railway domain or add your custom domain and create the DNS record Railway shows.
5. Keep the service at **1 replica**: live room state and Socket.io rooms are held in memory.

Avoid redeploying during a live study session: connected clients reconnect automatically and saved data is kept, but in-progress live state is reset.

For the Adaptive Scaffolding V2 release (backup, deploy, verify, first groups) follow [`06-researcher-operating-guide.md`](./docs/adaptive-scaffolding-v2/06-researcher-operating-guide.md).

Locally nothing changes: `npm run dev` (or `npm run build && npm start`) uses `./data/research.db` and binds to `127.0.0.1:3000`.
