/**
 * Applies a demo seed file (default scripts/seed-demo-groups.sql).
 *
 * Locally:
 *   node scripts/apply-seed.mjs
 *   node scripts/apply-seed.mjs data/research.db
 *   node scripts/apply-seed.mjs data/research.db seed-group-3.sql
 *
 * On Railway, from the app directory:
 *   node scripts/apply-seed.mjs /data/research.db
 *   node scripts/apply-seed.mjs /data/research.db seed-group-3.sql
 */
import fs from "node:fs";
import Database from "better-sqlite3";

const file =
  process.argv[2] ||
  process.env.DATABASE_URL?.replace(/^file:/, "") ||
  "data/research.db";

if (!fs.existsSync(file)) {
  console.error(`Database file not found: ${file}`);
  process.exit(1);
}

const seedFile = new URL(`./${process.argv[3] ?? "seed-demo-groups.sql"}`, import.meta.url);
if (!fs.existsSync(seedFile)) {
  console.error(`Seed file not found: ${seedFile.pathname}`);
  process.exit(1);
}
const sql = fs.readFileSync(seedFile, "utf8");
const active = sql.match(/^-- active: (.+)$/m)?.[1].split(/\s+/).filter(Boolean) ?? [];
if (active.length === 0) {
  console.error("Seed file is missing the active group codes.");
  process.exit(1);
}

const db = new Database(file);
db.pragma("foreign_keys = ON");
db.exec(sql);

const groups = db
  .prepare(
    `SELECT s.code, s.completed_at,
            (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id) AS members,
            (SELECT COUNT(*) FROM scenario_attempts a WHERE a.session_id = s.id AND a.submitted = 1) AS finished
     FROM sessions s
     WHERE s.code IN (${active.map(() => "?").join(", ")})
     ORDER BY s.code`
  )
  .all(...active);

for (const group of groups) {
  console.log(
    `${group.code}: ${group.members} members, ${group.finished} finished scenarios, completed ${group.completed_at}`
  );
}
if (groups.length !== active.length || groups.some((group) => group.finished !== 10)) {
  console.error(`Seed did not create ${active.length} finished group(s).`);
  process.exit(1);
}
