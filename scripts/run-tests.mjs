#!/usr/bin/env node
/**
 * Runs the automated tests against a disposable SQLite database.
 *
 * 1. Creates a temporary directory and pushes the current schema into a fresh
 *    template database there (never data/research.db).
 * 2. Runs every tests/**\/*.test.ts file with Node's test runner (through tsx).
 *    Each test file copies the template into its own database file.
 * 3. Deletes the temporary directory (set KEEP_TEST_DB=1 to keep it).
 *
 * AI keys and Adaptive V2 release flags from the shell are removed, so tests
 * never call a real AI provider and never depend on deployment settings.
 *
 * Usage: npm test            (all tests)
 *        npm test -- monitor (only files whose path contains "monitor")
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const filters = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "collab-tests-"));
const template = path.join(tmp, "template.db");
const productionDb = path.resolve(root, "data", "research.db");

if (path.resolve(template) === productionDb) {
  console.error("Refusing to run tests against data/research.db");
  process.exit(1);
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("ADAPTIVE_V2_") || key.startsWith("OPENAI_") || key === "ADMIN_PASSWORD") delete env[key];
}
Object.assign(env, {
  DATABASE_URL: `file:${template}`,
  OPENAI_API_KEY: "",
  NODE_ENV: "test",
  TEST_TEMPLATE_DB: template,
  TEST_TMP_DIR: tmp,
});

function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n${label} failed (exit ${result.status ?? result.signal})`);
    return false;
  }
  return true;
}

function findTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTests(full);
    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

let ok = false;
try {
  console.log(`Test database template: ${template}`);
  const pushed = run("Schema push", [
    path.join(root, "node_modules", "drizzle-kit", "bin.cjs"),
    "push",
    "--force",
  ]);
  if (pushed) {
    const files = findTests(path.join(root, "tests"))
      .map((file) => path.relative(root, file))
      .filter((file) => filters.length === 0 || filters.some((f) => file.includes(f)))
      .sort();
    if (files.length === 0) {
      console.error("No test files matched");
    } else {
      ok = run("Tests", [
        path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        "--test",
        "--test-reporter=spec",
        ...files,
      ]);
    }
  }
} finally {
  if (process.env.KEEP_TEST_DB === "1") {
    console.log(`Kept test databases in ${tmp}`);
  } else {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(ok ? 0 : 1);
