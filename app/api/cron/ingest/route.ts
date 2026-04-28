import { runIngest } from '@/src/lib/ingest/run-ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * Vercel Cron: GET with Authorization: Bearer <CRON_SECRET>
 * Local: GET with header or run `npm run ingest` instead.
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
    await runIngest();
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ingest failed';
    console.error(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
