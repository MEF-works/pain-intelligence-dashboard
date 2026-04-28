import { count, desc, gt, max } from 'drizzle-orm';
import { db } from '@/src/lib/db';
import { painSignals } from '@/src/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const byFocus = await db
    .select({
      focusArea: painSignals.focusArea,
      n: count(),
    })
    .from(painSignals)
    .groupBy(painSignals.focusArea)
    .orderBy(desc(count()));

  const byStatus = await db
    .select({
      status: painSignals.status,
      n: count(),
    })
    .from(painSignals)
    .groupBy(painSignals.status);

  const bySource = await db
    .select({
      source: painSignals.source,
      n: count(),
    })
    .from(painSignals)
    .groupBy(painSignals.source);

  const [tot] = await db.select({ n: count() }).from(painSignals);
  const [hv] = await db
    .select({ n: count() })
    .from(painSignals)
    .where(gt(painSignals.intensity, 85));
  const [latest] = await db.select({ t: max(painSignals.createdAt) }).from(painSignals);

  const lastAt =
    latest?.t instanceof Date
      ? latest.t.toISOString()
      : latest?.t
        ? new Date(latest.t as unknown as string | number).toISOString()
        : null;

  return Response.json({
    total: tot?.n ?? 0,
    highValueLeads: hv?.n ?? 0,
    lastSignalAt: lastAt,
    byFocus: byFocus.map((r) => ({
      focusArea: r.focusArea ?? 'unknown',
      count: r.n,
    })),
    byStatus: byStatus.map((r) => ({
      status: r.status ?? 'unknown',
      count: r.n,
    })),
    bySource: bySource.map((r) => ({
      source: r.source ?? 'unknown',
      count: r.n,
    })),
  });
}
