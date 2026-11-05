import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";
// Timestamps and counters are safe integers in this application.
types.setTypeParser(20, Number);
let sqlite: DatabaseSync | undefined;
let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
const context = new AsyncLocalStorage<PoolClient | "sqlite">();
let tail = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
export function cloudDatabase() {
  return Boolean(process.env.DATABASE_URL);
}
export function storageConfigured() {
  return !process.env.VERCEL || cloudDatabase();
}
const schema = `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS auth (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, prompt TEXT NOT NULL, model TEXT NOT NULL, size TEXT NOT NULL, quality TEXT NOT NULL, refs TEXT NOT NULL, parent_id TEXT, status TEXT NOT NULL CHECK(status IN ('queued','generating','completed','failed')), result_id TEXT, error TEXT, uncertain INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, started INTEGER, finished INTEGER, count INTEGER NOT NULL DEFAULT 1, results TEXT NOT NULL DEFAULT '[]', dispatch_at INTEGER);
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created);
    CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id, created);
    CREATE TABLE IF NOT EXISTS usage_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, units INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS submissions (user_id TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(user_id,key));
    CREATE TABLE IF NOT EXISTS worker_health (id INTEGER PRIMARY KEY CHECK(id=1), seen INTEGER NOT NULL);
  `;
async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    if (process.env.VERCEL && !cloudDatabase())
      throw new Error(
        "DATABASE_URL is required on Vercel; local disk is never used there.",
      );
    if (cloudDatabase()) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 4,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 10000,
      });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(8642001)");
        await client.query(
          schema
            .replace(/\bINTEGER\b/g, "BIGINT")
            .replace(/\bBLOB\b/g, "BYTEA"),
        );
        await client.query(
          "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS count BIGINT NOT NULL DEFAULT 1; ALTER TABLE jobs ADD COLUMN IF NOT EXISTS results TEXT NOT NULL DEFAULT '[]'; ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dispatch_at BIGINT; ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS units BIGINT NOT NULL DEFAULT 1;",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      const path = resolve(
        /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
          "./data/studio.sqlite",
      );
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      sqlite = new DatabaseSync(path);
      sqlite.exec(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;" +
          schema,
      );
      const columns = sqlite.prepare("PRAGMA table_info(jobs)").all() as {
        name: string;
      }[];
      for (const [name, definition] of [
        ["count", "INTEGER NOT NULL DEFAULT 1"],
        ["results", "TEXT NOT NULL DEFAULT '[]'"],
        ["dispatch_at", "INTEGER"],
      ])
        if (!columns.some((c) => c.name === name))
          sqlite.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
      if (
        !(
          sqlite.prepare("PRAGMA table_info(usage_events)").all() as {
            name: string;
          }[]
        ).some((c) => c.name === "units")
      )
        sqlite.exec(
          "ALTER TABLE usage_events ADD COLUMN units INTEGER NOT NULL DEFAULT 1",
        );
    }
  })().catch((error) => {
    initialized = undefined;
    throw error;
  });
  return initialized;
}
function postgresSQL(sql: string) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}
export async function all<T>(
  sql: string,
  ...args: SQLInputValue[]
): Promise<T[]> {
  await initialize();
  const current = context.getStore();
  if (pool) {
    const client = current && current !== "sqlite" ? current : pool;
    return (await client.query(postgresSQL(sql), args)).rows as T[];
  }
  const query = async () => sqlite!.prepare(sql).all(...args) as T[];
  return current === "sqlite" ? query() : exclusive(query);
}
export async function get<T>(
  sql: string,
  ...args: SQLInputValue[]
): Promise<T | undefined> {
  return (await all<T>(sql, ...args))[0];
}
export async function run(
  sql: string,
  ...args: SQLInputValue[]
): Promise<void> {
  await initialize();
  const current = context.getStore();
  if (pool) {
    await (current && current !== "sqlite" ? current : pool).query(
      postgresSQL(sql),
      args,
    );
    return;
  }
  const query = async () => {
    sqlite!.prepare(sql).run(...args);
  };
  if (current === "sqlite") await query();
  else await exclusive(query);
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  await initialize();
  if (context.getStore()) return fn();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes small queue/quota mutations across Vercel instances. No API calls occur under this lock.
      await client.query("SELECT pg_advisory_xact_lock(8642002)");
      const result = await context.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return exclusive(async () => {
    sqlite!.exec("BEGIN IMMEDIATE");
    try {
      const result = await context.run("sqlite", fn);
      sqlite!.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite!.exec("ROLLBACK");
      throw error;
    }
  });
}
export async function closeDatabase() {
  await initialized;
  sqlite?.close();
  await pool?.end();
  sqlite = undefined;
  pool = undefined;
  initialized = undefined;
}
export type User = {
  id: string;
  email: string;
  password: string;
  active: number;
};
export type Session = {
  id: string;
  user_id: string;
  title: string;
  created: number;
  updated: number;
};
export type Asset = {
  id: string;
  user_id: string;
  session_id: string;
  mime: string;
  width: number;
  height: number;
  bytes: Uint8Array;
};
export type Job = {
  id: string;
  user_id: string;
  session_id: string;
  prompt: string;
  model: string;
  size: string;
  quality: string;
  refs: string;
  parent_id: string | null;
  status: "queued" | "generating" | "completed" | "failed";
  result_id: string | null;
  error: string | null;
  uncertain: number;
  created: number;
  started: number | null;
  finished: number | null;
  count: number;
  results: string;
  dispatch_at: number | null;
};
