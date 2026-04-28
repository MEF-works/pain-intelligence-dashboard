/**
 * One-shot: remove legacy job-board rows (`source = job_rss`) after dropping RSS ingest.
 * Uses same .env / DATABASE_PATH as other scripts.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { resolve } from 'path';
import { db } from '../src/lib/db';
import { painSignals } from '../src/lib/db/schema';

const root = process.cwd();
loadEnv({ path: resolve(root, '.env') });
loadEnv({ path: resolve(root, '.env.local'), override: true });

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
