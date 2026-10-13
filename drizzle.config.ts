import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

const dbPath = process.env.DATABASE_URL?.replace(/^file:/, "") || "./data/research.db";

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
