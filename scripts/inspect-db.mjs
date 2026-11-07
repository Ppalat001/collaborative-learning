/**
 * Read-only summary of a research database: tables and every group with its
 * provenance, so researchers can check what a database contains before a
 * migration or release.
 *
 *   node scripts/inspect-db.mjs [path/to/research.db]
 */
import fs from "node:fs";
import Database from "better-sqlite3";

const file =
  process.argv[2] || process.env.DATABASE_URL?.replace(/^file:/, "") || "data/research.db";
if (!fs.existsSync(file)) {
  console.error(`Database file not found: ${file}`);
  process.exit(1);
}

const db = new Database(file, { readonly: true, fileMustExist: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name);
console.log(`Database: ${file}`);
console.log(`Tables (${tables.length}): ${tables.join(", ")}`);

const hasV2 = tables.includes("study_assignments");
const sessions = db
  .prepare(
    `SELECT s.code, s.created_at, s.completed_at,
            ${hasV2 ? "sa.research_condition, sa.roster_frozen_at" : "NULL AS research_condition, NULL AS roster_frozen_at"},
            (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id) AS members,
            (SELECT COUNT(*) FROM scenario_attempts a WHERE a.session_id = s.id AND a.submitted = 1) AS finished
     FROM sessions s
     ${hasV2 ? "LEFT JOIN study_assignments sa ON sa.session_id = s.id" : ""}
     ORDER BY s.created_at`
  )
  .all();

console.log(`Groups (${sessions.length}):`);
for (const s of sessions) {
  const provenance = s.research_condition
    ? `V2 ${s.research_condition}${s.roster_frozen_at ? "" : " (not started)"}`
    : "legacy (pre-V2)";
  console.log(
    `  ${s.code}  created ${s.created_at}  members ${s.members}  finished ${s.finished}/10  ` +
      `${s.completed_at ? "completed" : "IN PROGRESS"}  ${provenance}`
  );
}
db.close();
