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
  return drizzle(sqlite, { schema });
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
