// Test-only database; never opens the working application's database.
import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
process.env.DATABASE_PATH = resolve("test-results/ui.sqlite");
delete process.env.DATABASE_URL;
mkdirSync("test-results", { recursive: true });
for (const suffix of ["", "-wal", "-shm"])
  rmSync(process.env.DATABASE_PATH + suffix, { force: true });
const { all, closeDatabase } = await import("../lib/db");
await all("SELECT id FROM users LIMIT 1");
await closeDatabase();
