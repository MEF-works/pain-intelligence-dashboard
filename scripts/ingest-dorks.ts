import { config as loadEnv } from 'dotenv';
import path, { resolve } from 'path';
import { runDorkIngest } from '../src/lib/ingest/ingest-dorks';

const root = process.cwd();
loadEnv({ path: resolve(root, '.env') });
loadEnv({ path: resolve(root, '.env.local'), override: true });

const rawDb = process.env.DATABASE_PATH?.trim();
const resolvedDb = rawDb ? path.resolve(rawDb) : path.join(root, 'data', 'pain.db');

runDorkIngest()
  .then(() => {
    console.log(`[ingest-dorks] script cwd DB path (for your reference): ${resolvedDb}`);
    console.log(
      '[ingest-dorks] Production Docker: prefer hitting the app so data hits the live volume — ' +
        '`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://signal.mgmalkz.com/api/cron/ingest-dorks` ' +
        '(see PROJECT_SOURCE_OF_TRUTH.md §6 / §10).'
    );
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
