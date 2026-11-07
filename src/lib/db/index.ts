import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

type AppDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as typeof globalThis & { __studyDb?: AppDb };

function createDb(): AppDb {
  const dbPath =
    process.env.DATABASE_URL?.replace(/^file:/, "") ||
    path.join(process.cwd(), "data", "research.db");

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath, { timeout: 8000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 8000");
  sqlite.pragma("foreign_keys = ON");
  ensureResearchTriggers(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * A group's research condition and versions may never change after creation; the
 * roster can only go from unfrozen to frozen. drizzle-kit push does not manage
 * triggers, so they are (re)created here when the table exists.
 */
export function ensureResearchTriggers(sqlite: Database.Database) {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_assignments'")
    .get();
  if (!exists) return;
  const immutable = [
    "session_id",
    "research_condition",
    "assignment_method",
    "created_via",
    "study_protocol_version",
    "consent_version",
    "information_sheet_version",
    "scenario_set_version",
    "assessment_version",
    "intervention_policy_version",
    "model_config_version",
    "ai_mode_at_assignment",
    "min_group_size",
    "max_group_size",
    "features",
    "assigned_at",
  ];
  const changed = immutable.map((column) => `NEW.${column} IS NOT OLD.${column}`).join(" OR ");
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS study_assignments_immutable
    BEFORE UPDATE ON study_assignments
    WHEN ${changed}
      OR (OLD.roster_frozen_at IS NOT NULL AND (
        NEW.roster_frozen_at IS NOT OLD.roster_frozen_at
        OR NEW.frozen_roster_ids IS NOT OLD.frozen_roster_ids
        OR NEW.started_by IS NOT OLD.started_by))
    BEGIN
      SELECT RAISE(ABORT, 'study assignment is immutable once created');
    END;
  `);
}

function getDb(): AppDb {
  if (!globalForDb.__studyDb) {
    globalForDb.__studyDb = createDb();
  }
  return globalForDb.__studyDb;
}

/**
 * Open SQLite on first query, not when this module is imported. `next build`
 * loads every API route in parallel workers; opening the file at import time
 * makes those workers contend and fail with SQLITE_BUSY.
 */
export const db: AppDb = new Proxy({} as AppDb, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

export { schema };
