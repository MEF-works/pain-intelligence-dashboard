import { desc } from 'drizzle-orm';
import { db } from '@/src/lib/db';
import { painSignals } from '@/src/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rows = await db
    .select()
    .from(painSignals)
    .orderBy(desc(painSignals.createdAt))
    .limit(200);

  return Response.json({
    signals: rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceUrl: r.sourceUrl,
      title: r.title,
      content: r.content,
      focusArea: r.focusArea,
      intensity: r.intensity ?? 0,
      status: r.status,
      rawBudget: r.rawBudget,
      auditLog: r.auditLog ?? null,
      lastVerifiedAt:
        r.lastVerifiedAt instanceof Date
          ? r.lastVerifiedAt.toISOString()
          : r.lastVerifiedAt != null
            ? new Date(r.lastVerifiedAt as unknown as string | number).toISOString()
            : null,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt as unknown as string | number).toISOString(),
    })),
  });
}
