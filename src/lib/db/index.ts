import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/** Absolute path recommended for scripts; default `./data/pain.db` under cwd. */
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'pain.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
