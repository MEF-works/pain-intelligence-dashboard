import { runIngest } from '../src/lib/ingest/run-ingest';

runIngest()
  .then(() => {
    console.log('[ingest] done');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
