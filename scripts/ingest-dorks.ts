import { GOOGLE_DORK_QUERIES } from '../lib/constants/dorks';
import { capturePainSignal, hashContent } from '../src/lib/ingest/run-ingest';

type SerperOrganic = { title?: string; link?: string; snippet?: string };

function canonicalUrl(href: string): string {
  try {
    const u = new URL(href);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
      u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return href.trim();
  }
}

function enrichDorkContent(opts: {
  canonicalUrl: string;
  dorkLabel: string;
  title: string;
  snippet: string;
}): string {
  return [
    `Lead source: publicly indexed failure page (Serper search hit).`,
    `Matched pattern: ${opts.dorkLabel}`,
    `URL: ${opts.canonicalUrl}`,
    `Title: ${opts.title}`,
    `Snippet: ${opts.snippet}`,
    '',
    'Public error screens typically correlate with lost organic visibility, abandoned carts, and immediate trust damage until the stack is stabilized.',
  ].join('\n');
}

async function serperSearch(q: string): Promise<SerperOrganic[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) {
    throw new Error('SERPER_API_KEY is not set');
  }
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Serper HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as { organic?: SerperOrganic[] };
  return data.organic ?? [];
}

async function runDorkIngest(): Promise<void> {
  let captured = 0;
  for (const dork of GOOGLE_DORK_QUERIES) {
    console.log(`[ingest-dorks] query "${dork.label}" …`);
    let organic: SerperOrganic[];
    try {
      organic = await serperSearch(dork.query);
    } catch (e) {
      console.error(`[ingest-dorks] Serper failed for ${dork.id}:`, e);
      continue;
    }
    for (const row of organic) {
      const link = typeof row.link === 'string' ? row.link.trim() : '';
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const snippet = typeof row.snippet === 'string' ? row.snippet.trim() : '';
      if (!link) continue;

      const url = canonicalUrl(link);
      const content = enrichDorkContent({
        canonicalUrl: url,
        dorkLabel: dork.label,
        title: title || '(no title)',
        snippet: snippet || '(no snippet)',
      });

      const idBase = `gdork:${hashContent(url)}`;
      const id = idBase.length > 200 ? idBase.slice(0, 200) : idBase;

      const r = await capturePainSignal({
        id,
        source: 'google_dork',
        sourceUrl: url,
        title: title || `Google lead: ${dork.label}`,
        content,
        focusAreaId: dork.focusAreaId,
        createdAt: new Date(),
      });
      if (r.ok) captured += 1;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`[ingest-dorks] done — ${captured} new row(s) stored`);
}

runDorkIngest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
