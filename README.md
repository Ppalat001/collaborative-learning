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
   - Discuss together (live sync)
   - Choose one scaffolding type
   - Review AI response (synced to all devices)
   - Submit final group answer
   - Complete brief survey with optional open reflection
6. Each participant completes the **post-test**
7. Researcher exports CSV from `/admin` (scenario data + pre/post scores)

## Research data export

Visit `/admin`, enter the admin password (default: `research-admin`), and download CSV.

Columns include: session code, scenario, scaffolding type, discussion text, AI response, final answer, timing metrics, and survey ratings.

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

## Deployment notes

Deploy to Railway, Render, or similar (requires persistent PostgreSQL and a Node process for WebSocket support). Vercel serverless alone does not support the integrated Socket.io server — use a platform that runs `server.ts`.
