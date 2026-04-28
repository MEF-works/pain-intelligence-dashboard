import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/** Absolute path recommended for scripts; default `./data/pain.db` under cwd. */
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'pain.db');

function createDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  return drizzle(sqlite, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

/**
 * Lazy SQLite connection — do not open the DB at module load (avoids Next.js HTML 500
 * when the route handler's catch cannot run because imports failed first).
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    const inst = getDb();
    const value = Reflect.get(inst as object, prop, receiver);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(inst)
      : value;
  },
});

export { schema };
