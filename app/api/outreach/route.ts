import { eq } from 'drizzle-orm';
import { db } from '@/src/lib/db';
import { painSignals } from '@/src/lib/db/schema';
import { generateTargetedBridge } from '@/lib/ai/outreach';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string };
  if (typeof body.id !== 'string') {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  const [row] = await db.select().from(painSignals).where(eq(painSignals.id, body.id)).limit(1);
  if (!row) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  const text = await generateTargetedBridge({
    content: row.content,
    focusArea: row.focusArea,
  });
  return Response.json({ text });
}
