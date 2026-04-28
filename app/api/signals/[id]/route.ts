import { eq } from 'drizzle-orm';
import { db } from '@/src/lib/db';
import { painSignals } from '@/src/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED = ['new', 'outreached', 'paid', 'dead'] as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: raw } = await context.params;
  const id = decodeURIComponent(raw);
  const body = (await request.json()) as { status?: string };
  if (typeof body.status !== 'string') {
    return Response.json({ error: 'status required' }, { status: 400 });
  }
  if (!ALLOWED.includes(body.status as (typeof ALLOWED)[number])) {
    return Response.json({ error: 'invalid status' }, { status: 400 });
  }
  await db
    .update(painSignals)
    .set({ status: body.status, lastUpdated: new Date() })
    .where(eq(painSignals.id, id));
  return Response.json({ ok: true });
}
