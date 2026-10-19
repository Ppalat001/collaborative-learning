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

1. Researcher clicks **Create session** and shares the room code
2. 2–4 students join with first names/nicknames
3. Group records informed consent in the lobby
4. Each participant completes the **pre-test** individually
5. For each scenario:
   - Read the task
   - Discuss together in a live group chat (each message shows the student's name, time and their own colour, and is logged under their anonymous ID)
   - **Individual AI support (Step 2):** each student privately selects any number of AI options (or none). Each option's response is generated once per student and stored; unselecting hides it and selecting it again shows the same response without a new AI call. Other members never see it
   - **Final group answer (Step 3):** everyone types in one shared box (max 500 words). Each student's text is highlighted in their own colour, and a bar above the answer lists every member with their colour, share of the text and status
   - Each student clicks **I am good** when happy (this pauses their typing; clicking again unselects it). The scenario finishes only when **every** member is marked good
   - **Every** student completes the scenario rating on their own device
6. Each participant completes the **post-test** and short end-of-study open questions
7. Researcher scores the final answers with the rubric and exports CSVs from `/admin`

## Research data export

Visit `/admin`, enter the admin password (`ADMIN_PASSWORD`; locally defaults to `research-admin`, required in production), click **Load groups** and choose a group. Every export is for one group (`/api/admin/export?type=…&session=GROUP-XXXX`; without `session` it is rejected). Students are shown by nickname plus their anonymous `student_id`, times are UTC, and percentages are 0–100.

| Export | One row per |
|---|---|
| Group answers per scenario | scenario (members, final answer, who wrote what share, AI help each student used, highest AI level, % of the answer copied from AI, chat before/after AI, minutes, rubric total) |
| Discussion chat log | chat message (student, time, before or after the group's first AI request) |
| Individual AI support | student × scenario × AI option (level, times shown/hidden, the AI reply) |
| Individual contributions | student × scenario (chat messages and words, characters typed, share of the final answer) |
| Individual scenario ratings | student × scenario (1–5 ratings, amount of AI help, comment) |
| Pre/post-test comparison | student (pre and post score, each concept and the two written answers side by side) |
| End questionnaire | student (answers to the questions after the post-test) |
| Rubric scores | scenario × rater (6 criteria scored 1–4, total 6–24, average) |

### Cleaning the database

On `/admin` after loading the groups, **Delete group** removes the chosen group and everything recorded for it (type its code to confirm), and **Delete all groups** empties the study data (type `DELETE ALL`). Locally you can instead stop the server and delete `data/research.db`, `data/research.db-wal` and `data/research.db-shm`; the next `npm run dev` creates a fresh database.

Research instruments (survey items, end-of-study questions, rubric criteria) are defined in `src/lib/instruments.ts`.

## Pilot testing

With the server running:

```bash
npm run pilot:test
```

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
   - `OPENAI_API_KEY=<key>` (optional; mock AI otherwise)
   - `OPENAI_MODEL=<model>` (optional; defaults to `gpt-4o-mini`)
   - `OPENAI_BASE_URL=<url>` (optional; for OpenAI-compatible providers such as OpenRouter or Groq)
4. **Settings → Networking**: generate a Railway domain or add your custom domain and create the DNS record Railway shows.
5. Keep the service at **1 replica**: live room state and Socket.io rooms are held in memory.

Avoid redeploying during a live study session: connected clients reconnect automatically and saved data is kept, but in-progress live state is reset.

Locally nothing changes: `npm run dev` (or `npm run build && npm start`) uses `./data/research.db` and binds to `127.0.0.1:3000`.
