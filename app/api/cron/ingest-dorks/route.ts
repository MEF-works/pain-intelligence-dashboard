import { runDorkIngest } from '@/src/lib/ingest/ingest-dorks';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * Same auth as `/api/cron/ingest`. Runs Serper dork ingest inside the app process
 * so rows land in the same SQLite file the dashboard reads (e.g. `/app/data/pain.db` in Docker).
 *
 * Requires `SERPER_API_KEY` in the app environment.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const captured = await runDorkIngest();
    return Response.json({ ok: true, captured, at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ingest failed';
    console.error(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
