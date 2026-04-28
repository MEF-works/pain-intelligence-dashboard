/**
 * One-shot: remove legacy job-board rows (`source = job_rss`) after dropping RSS ingest.
 * Uses same .env / DATABASE_PATH as other scripts.
 *
 * Docker Compose: the live DB is `/app/data/pain.db` inside `pain-intel`, not necessarily
 * `./data/pain.db` on the host — use the `docker compose exec … python3 -c "…"` snippet in
 * PROJECT_SOURCE_OF_TRUTH.md §10 if this script deletes 0 rows but the UI still shows job_rss.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import path, { resolve } from 'path';
import { db } from '../src/lib/db';
import { painSignals } from '../src/lib/db/schema';

const root = process.cwd();
loadEnv({ path: resolve(root, '.env') });
loadEnv({ path: resolve(root, '.env.local'), override: true });

const rawDb = process.env.DATABASE_PATH?.trim();
const resolvedDb = rawDb ? path.resolve(rawDb) : path.join(root, 'data', 'pain.db');
console.log(`[purge-job-rss] DATABASE_PATH → ${resolvedDb}`);

async function main() {
  const deleted = await db.delete(painSignals).where(eq(painSignals.source, 'job_rss')).returning({
    id: painSignals.id,
  });
  console.log(`[purge-job-rss] deleted ${deleted.length} row(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
