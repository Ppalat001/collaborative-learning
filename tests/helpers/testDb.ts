import fs from "node:fs";
import path from "node:path";

/**
 * Import first in every test file that touches the database. Copies the template
 * pushed by scripts/run-tests.mjs into a database owned by this test process.
 * The app opens SQLite lazily on first query, so setting DATABASE_URL here is
 * enough to keep every query away from data/research.db.
 */
const template = process.env.TEST_TEMPLATE_DB;
if (!template || !fs.existsSync(template)) {
  throw new Error("Run the tests with `npm test`: it creates a disposable template database");
}
const dir = process.env.TEST_TMP_DIR ?? path.dirname(template);
const file = path.join(dir, `test-${process.pid}-${Date.now()}.db`);
fs.copyFileSync(template, file);
process.env.DATABASE_URL = `file:${file}`;

export const TEST_DATABASE_FILE = file;
