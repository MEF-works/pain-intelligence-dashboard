import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { FOCUS_AREAS } from '../../../lib/constants/focus-areas';
import {
  adjustIntensityMonetization,
  buildOpportunityFields,
  shouldDiscardSignal,
} from '../action-engine/opportunity';
import { plainTextFromHtmlish } from '../html/plain-text';
import { db } from '../db';
import { painSignals } from '../db/schema';

const USER_AGENT = 'PainIntelDashboard/1.0 (local research)';

const JOB_RSS_URL =
  process.env.JOB_RSS_URL ?? 'https://remoteok.com/remote-jobs.rss';

/** Default X/Twitter recent-search queries (OR groups); override via TWITTER_SEARCH_QUERIES split by |||| */
const DEFAULT_TWITTER_QUERIES = [
  '("checkout broken" OR "stripe issues" OR "payment failed") lang:en',
  '("traffic but no sales" OR "users not signing up" OR "site not converting") lang:en',
];

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

async function capturePainSignal(opts: {
  id: string;
  source: string;
  sourceUrl: string;
  title: string | null;
  content: string;
  focusAreaId: string;
  createdAt: Date;
}): Promise<{ ok: boolean; hot: boolean }> {
  const fullText = `${opts.title ?? ''}\n\n${opts.content}`.replace(/\n{3,}/g, '\n\n');
  const h = hashContent(fullText);
  if (await hashExists(h)) return { ok: false, hot: false };

  const baseIntensity = computeSemanticIntensity(fullText);
  const intensity = adjustIntensityMonetization(baseIntensity, fullText);

  const opp = await buildOpportunityFields({
    title: opts.title,
    content: opts.content,
    focusAreaId: opts.focusAreaId,
    intensity,
    source: opts.source,
  });

  if (shouldDiscardSignal(opp)) {
    console.log(`[ingest] discard low-signal noise ${opts.source} ${opts.id}`);
    return { ok: false, hot: false };
  }

  await db
    .insert(painSignals)
    .values({
      id: opts.id,
      source: opts.source,
      sourceUrl: opts.sourceUrl,
      title: opts.title,
      content: opts.content.slice(0, 20000),
      contentHash: h,
      focusArea: opts.focusAreaId,
      intensity,
      status: 'new',
      createdAt: opts.createdAt,
      painSummary: opp.painSummary,
      likelyRootIssue: opp.likelyRootIssue,
      opportunityAngle: opp.opportunityAngle,
      businessImpact: opp.businessImpact,
      confidenceScore: opp.confidenceScore,
      actionType: opp.actionType,
    })
    .onConflictDoNothing();

  const hot = intensity > 80;
  console.log(`[SIGNAL CAPTURED] ${opts.source}/${opts.focusAreaId} — ${String(opts.title).slice(0, 80)}`);
  return { ok: true, hot };
}

/** Minimal RSS 2.0 item parse (no extra deps). */
function parseRssItems(xml: string): { title: string; link: string; content: string }[] {
  const out: { title: string; link: string; content: string }[] = [];
  const parts = xml.split(/<item>/i).slice(1);
  for (const part of parts) {
    const block = part.split(/<\/item>/i)[0] ?? '';
    const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descM = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const title = titleM ? plainTextFromHtmlish(titleM[1] ?? '') : '';
    const link = linkM ? plainTextFromHtmlish(linkM[1] ?? '') : '';
    if (!title || !link) continue;
    const desc = descM ? plainTextFromHtmlish(descM[1] ?? '') : '';
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
  let data: {
    data?: { children?: { data: Record<string, unknown> }[] };
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    console.warn(`[ingest] r/${subreddit} response was not JSON (blocked HTML/rate limit?)`);
    return false;
  }
  const children = data.data?.children ?? [];
  let hot = false;
  for (const { data: post } of children) {
    const selftext = plainTextFromHtmlish(String(post.selftext ?? ''));
    const title = plainTextFromHtmlish(String(post.title ?? ''));
    const fullText = `${title}\n\n${selftext}`.replace(/\n{3,}/g, '\n\n');
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const createdUtc = Number(post.created_utc);
    const id = String(post.name ?? post.id);
    if (!id) continue;
    const content = selftext.trim() ? selftext : title;
    const baseUrl = `https://www.reddit.com${String(post.permalink ?? '')}`;
    const r = await capturePainSignal({
      id,
      source: 'reddit',
      sourceUrl: baseUrl,
      title,
      content,
      focusAreaId: area.id,
      createdAt: new Date(createdUtc * 1000),
    });
    if (r.hot) hot = true;
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
    const id = `rss:${hashContent(it.link)}`.slice(0, 200);
    const r = await capturePainSignal({
      id,
      source: 'job_rss',
      sourceUrl: it.link,
      title: it.title,
      content: fullText.slice(0, 20000),
      focusAreaId: area.id,
      createdAt: new Date(),
    });
    if (r.hot) hot = true;
  }
  return hot;
}

type HnItem = {
  title?: string;
  url?: string;
  text?: string;
  deleted?: boolean;
  dead?: boolean;
};

export async function fetchHackerNewsPain(): Promise<boolean> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/newstories.json', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`[ingest] HN list HTTP ${res.status}`);
    return false;
  }
  const ids = (await res.json()) as number[];
  const slice = ids.slice(0, 80);
  let hot = false;
  for (const id of slice) {
    const ir = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!ir.ok) continue;
    const item = (await ir.json()) as HnItem;
    if (!item?.title || item.deleted || item.dead) continue;
    const title = plainTextFromHtmlish(item.title);
    const body = item.text ? plainTextFromHtmlish(item.text) : '';
    const fullText = `${title}\n\n${body}`.trim();
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const url = item.url?.trim() || `https://news.ycombinator.com/item?id=${id}`;
    const sid = `hn:${id}`;
    const r = await capturePainSignal({
      id: sid,
      source: 'hackernews',
      sourceUrl: url,
      title,
      content: body || title,
      focusAreaId: area.id,
      createdAt: new Date(),
    });
    if (r.hot) hot = true;
  }
  return hot;
}

export async function fetchTwitterPain(): Promise<boolean> {
  const token = process.env.TWITTER_BEARER_TOKEN?.trim();
  if (!token) {
    console.log('[ingest] TWITTER_BEARER_TOKEN unset, skipping X/Twitter');
    return false;
  }
  const rawQ = process.env.TWITTER_SEARCH_QUERIES?.trim();
  const queries = rawQ
    ? rawQ.split('||||').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_TWITTER_QUERIES;

  let hot = false;
  for (const query of queries) {
    const url = `https://api.twitter.com/2/tweets/search/recent?${new URLSearchParams({
      query,
      max_results: '10',
      'tweet.fields': 'created_at,author_id',
    })}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      console.warn(`[ingest] Twitter HTTP ${response.status}`);
      continue;
    }
    const payload = (await response.json()) as {
      data?: { id: string; text: string; created_at?: string }[];
    };
    const tweets = payload.data ?? [];
    for (const tw of tweets) {
      const text = plainTextFromHtmlish(tw.text);
      const area = firstMatchingFocus(text);
      if (!area) continue;
      const createdAt = tw.created_at ? new Date(tw.created_at) : new Date();
      const link = `https://twitter.com/i/web/status/${tw.id}`;
      const r = await capturePainSignal({
        id: `tw:${tw.id}`,
        source: 'twitter',
        sourceUrl: link,
        title: text.slice(0, 300),
        content: text,
        focusAreaId: area.id,
        createdAt,
      });
      if (r.hot) hot = true;
    }
  }
  return hot;
}

type GhIssue = {
  html_url: string;
  title: string;
  body: string | null;
  repository_url: string;
  number: number;
};

export async function fetchGitHubIssuesPain(): Promise<boolean> {
  const q =
    process.env.GITHUB_ISSUES_QUERY?.trim() ||
    'is:issue is:open label:bug OR label:performance OR label:regression';
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=updated&per_page=15`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    console.warn(`[ingest] GitHub search HTTP ${response.status}`);
    return false;
  }
  const payload = (await response.json()) as { items?: GhIssue[] };
  const items = payload.items ?? [];
  let hot = false;
  for (const issue of items) {
    const title = plainTextFromHtmlish(issue.title);
    const body = issue.body ? plainTextFromHtmlish(issue.body) : '';
    const fullText = `${title}\n\n${body}`;
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const repoMatch = issue.repository_url.match(/\/repos\/([^/]+\/[^/]+)$/);
    const repo = repoMatch?.[1] ?? 'unknown';
    const sid = `gh:${repo}:${issue.number}`.slice(0, 200);
    const r = await capturePainSignal({
      id: sid,
      source: 'github_issue',
      sourceUrl: issue.html_url,
      title,
      content: body.slice(0, 20000) || title,
      focusAreaId: area.id,
      createdAt: new Date(),
    });
    if (r.hot) hot = true;
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

const DEFAULT_SUBS = [
  'ecommerce',
  'shopify',
  'wordpress',
  'smallbusiness',
  'entrepreneur',
  'startups',
  'dropshipping',
  'roastmystore',
  'saas',
  'webdev',
  'uxdesign',
] as const;

/**
 * Fetches public listings and upserts `pain_signals` (deduplicated by content hash).
 */
export async function runIngest(): Promise<void> {
  let anyHot = false;
  for (const sub of DEFAULT_SUBS) {
    const h = await fetchRedditPain(sub);
    if (h) anyHot = true;
  }

  if (process.env.JOB_RSS_ENABLED !== 'false') {
    if (await fetchJobRss()) anyHot = true;
  } else {
    console.log('[ingest] JOB_RSS_ENABLED=false, skipping job RSS');
  }

  if (await fetchHackerNewsPain()) anyHot = true;
  if (await fetchTwitterPain()) anyHot = true;
  if (await fetchGitHubIssuesPain()) anyHot = true;

  if (anyHot) {
    const copy = 'Pain Intel: at least one signal scored intensity > 80 in this run.';
    console.log(`[ingest/alert] ${copy}`);
    await ntfyAlert(copy);
  }
}
