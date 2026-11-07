#!/usr/bin/env node
/**
 * Runs the HTTP + Socket.IO pilots against a real production server that uses a
 * throwaway database, so data/research.db is never touched. Run `npm run build`
 * first.
 *
 *   node scripts/pilot-isolated.mjs [legacy|v2|all]     (default: all)
 *
 * "legacy": the original pilot with V2 switched off (ADAPTIVE_V2_ENABLED=false).
 * "v2":     default settings (V2 on) plus the test-only fast policy; the
 *           Adaptive Scaffolding V2 pilot.
 * Mock AI only: AI keys from the environment are removed.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const which = process.argv[2] ?? "all";
const root = process.cwd();
const realDb = path.resolve(root, "data", "research.db");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const drizzleCli = path.join(root, "node_modules", "drizzle-kit", "bin.cjs");
const ADMIN_PASSWORD = "pilot-admin";

if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

const RUNS = [
  { name: "legacy (V2 switched off)", flags: { ADAPTIVE_V2_ENABLED: "false" }, pilots: ["pilot-test.mjs"] },
  {
    name: "V2 (default settings)",
    flags: {
      ADAPTIVE_V2_ALLOW_TEST_POLICY: "true",
      ADAPTIVE_V2_SCHEDULER_MS: "1000",
    },
    pilots: ["pilot-adaptive-v2.mjs"],
  },
].filter((_, i) => which === "all" || (which === "legacy" ? i === 0 : which === "v2" ? i === 1 : false));
if (RUNS.length === 0) {
  console.error(`Unknown run "${which}". Use legacy, v2 or all.`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function baseEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ADAPTIVE_V2_") || key.startsWith("OPENAI_") || key === "ADMIN_PASSWORD" || key === "DATABASE_URL") {
      delete env[key];
    }
  }
  return env;
}

function startServer(env, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, "server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const log = fs.createWriteStream(logFile);
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error(`Server did not start within 90 s (log: ${logFile})`));
      }
    }, 90_000);
    const onData = (chunk) => {
      log.write(chunk);
      if (!ready && chunk.toString().includes("> Ready on")) {
        ready = true;
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      log.end();
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code} before it was ready (log: ${logFile})`));
      }
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });
}

let failed = false;
for (const run of RUNS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-pilot-"));
  const dbFile = path.join(dir, "pilot.db");
  if (path.resolve(dbFile) === realDb) throw new Error("Refusing to run a pilot on the research database");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...baseEnv(),
    ...run.flags,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: `file:${dbFile}`,
    ADMIN_PASSWORD,
    OPENAI_API_KEY: "",
  };
  console.log(`\n=== ${run.name} ===`);
  console.log(`Database: ${dbFile}`);

  const push = spawnSync(process.execPath, [drizzleCli, "push", "--force"], { cwd: root, env, encoding: "utf8" });
  if (push.status !== 0) {
    console.error(push.stdout, push.stderr);
    process.exit(1);
  }

  let server;
  try {
    server = await startServer(env, path.join(dir, "server.log"));
    for (const pilot of run.pilots) {
      console.log(`\n--- ${pilot} against ${base} ---`);
      const result = spawnSync(process.execPath, [path.join("scripts", pilot)], {
        cwd: root,
        env: { ...env, PILOT_BASE_URL: base },
        stdio: "inherit",
      });
      if (result.status !== 0) failed = true;
    }
  } catch (error) {
    console.error(error.message);
    failed = true;
  } finally {
    if (server) await stopServer(server);
  }

  console.log(`\n--- integrity check on ${run.name} database ---`);
  const integrity = spawnSync(process.execPath, [path.join("scripts", "verify-research-integrity.mjs"), dbFile], {
    cwd: root,
    stdio: "inherit",
  });
  if (integrity.status !== 0) failed = true;

  if (failed || process.env.KEEP_PILOT_DB === "1") console.log(`Kept for inspection: ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? "\nIsolated pilots FAILED" : "\nIsolated pilots PASSED");
process.exit(failed ? 1 : 0);
