import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { FOCUS_AREAS } from '../../../lib/constants/focus-areas';
import { db } from '../db';
import { painSignals } from '../db/schema';

const USER_AGENT = 'PainIntelDashboard/1.0 (local research)';

const JOB_RSS_URL =
  process.env.JOB_RSS_URL ?? 'https://remoteok.com/remote-jobs.rss';

export function hashContent(text: string): string {
  const n = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(n, 'utf8').digest('hex');
}

function firstMatchingFocus(
  text: string
): (typeof FOCUS_AREAS)[keyof typeof FOCUS_AREAS] | null {
  const lower = text.toLowerCase();
  for (const area of Object.values(FOCUS_AREAS)) {
    if (area.keywords.some((kw) => lower.includes(kw))) return area;
  }
  return null;
}

/** Semantic intensity: length (rant depth), money/urgency/support bonuses; clamped 0–100 */
export function computeSemanticIntensity(fullText: string): number {
  const lower = fullText.toLowerCase();
  let score = 30;

  const moneyHits = [
    'lost money',
    'revenue',
    'customers complaining',
    'refunds',
    'lawsuit',
    'stolen',
  ].some((k) => lower.includes(k));
  const urgencyHits = ['today', 'asap', 'right now', 'breaking', 'emergency'].some((k) =>
    lower.includes(k)
  );
  const supportHits = ['useless support', 'no response', 'ignored me'].some((k) =>
    lower.includes(k)
  );

  if (moneyHits) score += 30;
  if (urgencyHits) score += 20;
  if (supportHits) score += 15;
  if (fullText.length > 500) score *= 1.5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

async function hashExists(hash: string): Promise<boolean> {
  if (!hash) return true;
  const [row] = await db
    .select({ id: painSignals.id })
    .from(painSignals)
    .where(eq(painSignals.contentHash, hash))
    .limit(1);
  return Boolean(row);
}

/** Minimal RSS 2.0 item parse (no extra deps). */
function parseRssItems(xml: string): { title: string; link: string; content: string }[] {
  const out: { title: string; link: string; content: string }[] = [];
  const strip = (s: string) =>
    s
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const parts = xml.split(/<item>/i).slice(1);
  for (const part of parts) {
    const block = part.split(/<\/item>/i)[0] ?? '';
    const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descM = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const title = titleM ? strip(titleM[1] ?? '') : '';
    const link = linkM ? strip(linkM[1] ?? '') : '';
    if (!title || !link) continue;
    const desc = descM ? strip(descM[1] ?? '') : '';
    out.push({ title, link, content: `${title}\n\n${desc}` });
  }
  return out;
}

export async function fetchRedditPain(subreddit: string): Promise<boolean> {
  const response = await fetch(
    `https://www.reddit.com/r/${subreddit}/new.json?limit=25`,
    { headers: { 'User-Agent': USER_AGENT } }
  );
  if (!response.ok) {
    console.warn(`[ingest] r/${subreddit} HTTP ${response.status}`);
    return false;
  }
  const data = (await response.json()) as {
    data?: { children?: { data: Record<string, unknown> }[] };
  };
  const children = data.data?.children ?? [];
  let hot = false;
  for (const { data: post } of children) {
    const selftext = String(post.selftext ?? '');
    const title = String(post.title ?? '');
    const fullText = `${title}\n\n${selftext}`.replace(/\n{3,}/g, '\n\n');
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const createdUtc = Number(post.created_utc);
    const id = String(post.name ?? post.id);
    if (!id) continue;
    const content = selftext.trim() ? selftext : title;
    const h = hashContent(`${title}\n\n${content}`);
    if (await hashExists(h)) continue;
    const baseUrl = `https://www.reddit.com${String(post.permalink ?? '')}`;
    const intensity = computeSemanticIntensity(fullText);
    if (intensity > 80) hot = true;
    await db
      .insert(painSignals)
      .values({
        id,
        source: 'reddit',
        sourceUrl: baseUrl,
        title,
        content,
        contentHash: h,
        focusArea: area.id,
        intensity,
        status: 'new',
        createdAt: new Date(createdUtc * 1000),
      })
      .onConflictDoNothing();
    console.log(`[SIGNAL CAPTURED] reddit/${area.id} — ${title.slice(0, 80)}`);
  }
  return hot;
}

export async function fetchJobRss(): Promise<boolean> {
  if (!JOB_RSS_URL) {
    console.log('[ingest] JOB_RSS_URL empty, skipping RSS');
    return false;
  }
  const response = await fetch(JOB_RSS_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.warn(`[ingest] RSS ${response.status}`);
    return false;
  }
  const xml = await response.text();
  const items = parseRssItems(xml);
  let hot = false;
  for (const it of items) {
    const fullText = it.content;
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const h = hashContent(fullText);
    if (await hashExists(h)) continue;
    const id = `rss:${hashContent(it.link)}`.slice(0, 200);
    const intensity = computeSemanticIntensity(fullText);
    if (intensity > 80) hot = true;
    await db
      .insert(painSignals)
      .values({
        id,
        source: 'job_rss',
        sourceUrl: it.link,
        title: it.title,
        content: fullText.slice(0, 20000),
        contentHash: h,
        focusArea: area.id,
        intensity,
        status: 'new',
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    console.log(`[SIGNAL CAPTURED] job_rss/${area.id} — ${it.title.slice(0, 80)}`);
  }
  return hot;
}

async function ntfyAlert(message: string) {
  const url = process.env.NTFY_URL;
  if (!url) {
    console.log(`[ingest/alert] (set NTFY_URL for push) ${message}`);
    return;
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      body: message,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!r.ok) console.warn(`[ingest] ntfy ${r.status}`);
  } catch (e) {
    console.warn('[ingest] ntfy failed', e);
  }
}

const DEFAULT_SUBS = ['ecommerce', 'shopify', 'wordpress'] as const;

/**
 * Fetches public listings and upserts `pain_signals` (deduplicated by content hash).
 */
export async function runIngest(): Promise<void> {
  let anyHot = false;
  for (const sub of DEFAULT_SUBS) {
    const h = await fetchRedditPain(sub);
    if (h) anyHot = true;
  }
  if (await fetchJobRss()) anyHot = true;

  if (anyHot) {
    const copy = 'Pain Intel: at least one signal scored intensity > 80 in this run.';
    console.log(`[ingest/alert] ${copy}`);
    await ntfyAlert(copy);
  }
}
