#!/usr/bin/env node
/**
 * Rehearses the Adaptive Scaffolding V2 schema push on a COPY of a database and
 * proves that existing research data is untouched. The source file is opened
 * read-only and never changed.
 *
 *   node scripts/rehearse-migration.mjs [path/to/research.db] [--keep]
 *
 * Steps: consistent backup copy -> fingerprint every existing table -> run the
 * same non-forced `drizzle-kit push` that `npm start` runs -> compare every
 * original column of every original row -> run the integrity checker.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const source = path.resolve(args.find((a) => !a.startsWith("--")) || "data/research.db");
if (!fs.existsSync(source)) {
  console.error(`Database file not found: ${source}`);
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-migration-"));
const copy = path.join(dir, "rehearsal.db");
const fail = (message) => {
  console.error(`FAILED: ${message}`);
  console.error(`Copy kept for inspection: ${copy}`);
  process.exit(1);
};

const src = new Database(source, { readonly: true, fileMustExist: true });
await src.backup(copy);
src.close();

function fingerprint(file, only) {
  const db = new Database(file, { readonly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
    .all()
    .map((row) => row.name)
    .filter((name) => !only || only[name]);
  const result = {};
  for (const table of tables) {
    const columns = only?.[table]?.columns ?? db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
    const list = columns.map((c) => `"${c}"`).join(", ");
    const rows = db.prepare(`SELECT ${list} FROM "${table}" ORDER BY rowid`).raw().all();
    const hash = crypto.createHash("sha256");
    for (const row of rows) hash.update(JSON.stringify(row));
    result[table] = { columns, rows: rows.length, sha256: hash.digest("hex") };
  }
  db.close();
  return result;
}

const before = fingerprint(copy);
console.log(`Source: ${source}`);
console.log(`Copy:   ${copy}`);
console.log(`Existing tables: ${Object.keys(before).length}`);

const push = spawnSync(process.execPath, [path.join("node_modules", "drizzle-kit", "bin.cjs"), "push"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `file:${copy}` },
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  timeout: 120_000,
});
const pushOutput = `${push.stdout ?? ""}${push.stderr ?? ""}`;
if (push.error || push.status !== 0) {
  console.error(pushOutput);
  fail(`drizzle-kit push did not finish cleanly (${push.error?.message ?? `exit ${push.status}`}). It may need an interactive confirmation, which Railway cannot give.`);
}
if (/data loss|truncate|drop table|drop column/i.test(pushOutput)) {
  console.error(pushOutput);
  fail("drizzle-kit reported a destructive statement.");
}

const after = fingerprint(copy, before);
for (const [table, original] of Object.entries(before)) {
  const now = after[table];
  if (!now) fail(`table ${table} disappeared`);
  if (now.rows !== original.rows) fail(`${table}: ${original.rows} rows before, ${now.rows} after`);
  if (now.sha256 !== original.sha256) fail(`${table}: original column values changed`);
  console.log(`  unchanged  ${table.padEnd(28)} ${String(original.rows).padStart(6)} rows`);
}

const check = new Database(copy, { readonly: true });
const tablesNow = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const added = [...tablesNow].filter((t) => !before[t] && !t.startsWith("sqlite_") && !t.startsWith("__drizzle"));
const participantColumns = check.prepare("PRAGMA table_info(participants)").all().map((c) => c.name);
const tokenRows = participantColumns.includes("auth_token_hash")
  ? check.prepare("SELECT COUNT(*) AS n FROM participants WHERE auth_token_hash IS NOT NULL").get().n
  : null;
check.close();
if (!tablesNow.has("study_assignments")) fail("study_assignments was not created");
for (const table of [
  "learner_models",
  "learner_model_events",
  "group_state_estimates",
  "private_decision_traces",
  "scaffolding_state_events",
  "offer_exposures",
  "intervention_outcome_evaluations",
  "intervention_progress_feedback",
  "open_answer_rubric_scores",
  "human_review_labels",
]) {
  if (!tablesNow.has(table)) fail(`${table} was not created`);
}
if (tokenRows === null) fail("participants.auth_token_hash was not added");
if (tokenRows !== 0) fail("existing participants received token hashes");
console.log(`Added tables (${added.length}): ${added.sort().join(", ")}`);
console.log("Added column: participants.auth_token_hash (NULL for every existing member)");

const integrity = spawnSync(process.execPath, [path.join("scripts", "verify-research-integrity.mjs"), copy], {
  cwd: process.cwd(),
  encoding: "utf8",
});
process.stdout.write(integrity.stdout);
if (integrity.status !== 0) fail("integrity check reported violations");

if (keep) console.log(`\nCopy kept: ${copy}`);
else fs.rmSync(dir, { recursive: true, force: true });
console.log("\nRehearsal passed: the push is additive and every existing row is unchanged.");
