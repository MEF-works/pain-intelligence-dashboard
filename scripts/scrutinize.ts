/**
 * Proof-of-life check for newest `new` signals: fetch sourceUrl, mark dead if gone/removed.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { painSignals } from '../src/lib/db/schema';

const USER_AGENT = 'PainIntelDashboard/1.0 (scrutinize)';

function appendAuditLine(prev: string | null | undefined, line: string): string {
  const p = prev?.trim();
  return p ? `${p}\n${line}` : line;
}

/** Body snippets that often indicate removed / deleted public content */
const REMOVED_MARKERS = [
  '[removed]',
  '[deleted]',
  'removed by moderator',
  'removed by moderators',
  'this post has been removed',
  'this comment has been removed',
  'sorry, this post was deleted',
  'page not found',
  'content unavailable',
  'no longer available',
  'has been deleted',
  'deleted by',
];

function looksRemoved(htmlOrText: string): boolean {
  const lower = htmlOrText.slice(0, 120_000).toLowerCase();
  return REMOVED_MARKERS.some((m) => lower.includes(m));
}

async function scrutinizeOne(row: {
  id: string;
  sourceUrl: string;
  auditLog: string | null;
}): Promise<void> {
  const ts = new Date().toISOString();
  let httpStatus = 0;
  let bodySnippet = '';
  let dead = false;
  let reason = 'ok';

  try {
    const res = await fetch(row.sourceUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    httpStatus = res.status;
    if (res.status === 404 || res.status === 410) {
      dead = true;
      reason = `http ${res.status}`;
    } else if (res.ok) {
      const text = await res.text();
      bodySnippet = text;
      if (looksRemoved(text)) {
        dead = true;
        reason = 'removed/deleted markers in body';
      }
    } else {
      reason = `http ${res.status} (unchanged)`;
    }
  } catch (e) {
    reason = e instanceof Error ? `fetch_error:${e.message}` : 'fetch_error';
  }

  const auditLine = `${ts}\tscrutinize\thttp=${httpStatus}\t${dead ? `dead:${reason}` : reason}`;
  const nextLog = appendAuditLine(row.auditLog, auditLine);

  await db
    .update(painSignals)
    .set({
      status: dead ? 'dead' : 'new',
      lastVerifiedAt: new Date(),
      auditLog: nextLog,
      lastUpdated: new Date(),
    })
    .where(eq(painSignals.id, row.id));

  console.log(
    `[scrutinize] ${row.id.slice(0, 40)}… ${dead ? 'DEAD' : 'ok'} (${reason}) ${httpStatus || ''}`
  );
  if (dead && bodySnippet && httpStatus === 200) {
    console.log(`  hint: body matched removal heuristics`);
  }
}

async function main() {
  const rows = await db
    .select({
      id: painSignals.id,
      sourceUrl: painSignals.sourceUrl,
      auditLog: painSignals.auditLog,
    })
    .from(painSignals)
    .where(eq(painSignals.status, 'new'))
    .orderBy(desc(painSignals.createdAt))
    .limit(10);

  if (rows.length === 0) {
    console.log('[scrutinize] no signals with status=new');
    return;
  }

  for (const row of rows) {
    await scrutinizeOne(row);
  }
  console.log(`[scrutinize] checked ${rows.length} row(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
