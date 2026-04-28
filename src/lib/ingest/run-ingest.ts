import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { REDDIT_SEARCH_QUERIES } from '../../../lib/constants/reddit-search-queries';
import { FOCUS_AREAS } from '../../../lib/constants/focus-areas';
import {
  adjustIntensityMonetization,
  buildOpportunityFields,
  shouldDiscardSignal,
} from '../action-engine/opportunity';
import { plainTextFromHtmlish } from '../html/plain-text';
import { db } from '../db';
import { painSignals } from '../db/schema';
import { qualifySignal, type SignalIdentity } from './signal-filters';

const USER_AGENT = 'PainIntelDashboard/1.0 (local research)';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** First-person + pain operators on X; override via TWITTER_SEARCH_QUERIES split by |||| */
const DEFAULT_TWITTER_QUERIES = [
  `("my site is down" OR "my site is broken") lang:en`,
  `("customers can't checkout" OR "checkout broken" OR "checkout not working") lang:en`,
  `("lost sales because" OR "losing sales" OR "sales dropped") lang:en`,
  `("stripe not working" OR "payment failing" OR "paypal not working") lang:en`,
  `("users not converting" OR "traffic but no sales") lang:en`,
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

/** Upserts one row when `content_hash` is new; skips duplicates (SHA-256 of normalized title+body). */
export async function capturePainSignal(opts: {
  id: string;
  source: string;
  sourceUrl: string;
  title: string | null;
  content: string;
  focusAreaId: string;
  createdAt: Date;
  identity?: Partial<SignalIdentity> & { platform: string };
}): Promise<{ ok: boolean; hot: boolean }> {
  const fullText = `${opts.title ?? ''}\n\n${opts.content}`.replace(/\n{3,}/g, '\n\n');
  const h = hashContent(fullText);
  if (await hashExists(h)) return { ok: false, hot: false };

  const identityHint = opts.identity ?? { platform: opts.source };
  const radar = qualifySignal(
    {
      source: opts.source,
      sourceUrl: opts.sourceUrl,
      title: opts.title,
      text: opts.content,
    },
    identityHint
  );
  if (!radar.ok) {
    console.log(`[ingest/radar] skip ${opts.source} — ${radar.reason}`);
    return { ok: false, hot: false };
  }

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
      buyerScore: radar.buyerScore,
      priority: radar.priority,
      identityJson: JSON.stringify(radar.identity),
    })
    .onConflictDoNothing();

  const hot = intensity > 80;
  console.log(`[SIGNAL CAPTURED] ${opts.source}/${opts.focusAreaId} — ${String(opts.title).slice(0, 80)}`);
  return { ok: true, hot };
}

/** Global Reddit search (not blind subreddit firehose). */
export async function fetchRedditSearchPain(): Promise<boolean> {
  const rawQ = process.env.REDDIT_SEARCH_QUERIES?.trim();
  const queries = rawQ
    ? rawQ.split('||||').map((s) => s.trim()).filter(Boolean)
    : [...REDDIT_SEARCH_QUERIES];

  let hot = false;
  for (const q of queries) {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=month&limit=25`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) {
      console.warn(`[ingest] Reddit search HTTP ${response.status} for q=${q.slice(0, 40)}…`);
      await sleep(800);
      continue;
    }
    let data: { data?: { children?: { data: Record<string, unknown> }[] } };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      console.warn('[ingest] Reddit search response was not JSON');
      await sleep(800);
      continue;
    }
    const children = (data.data?.children ?? []) as { kind: string; data: Record<string, unknown> }[];
    for (const child of children) {
      if (child.kind !== 't3') continue;
      const post = child.data;
      const selftext = plainTextFromHtmlish(String(post.selftext ?? ''));
      const title = plainTextFromHtmlish(String(post.title ?? ''));
      const fullText = `${title}\n\n${selftext}`.replace(/\n{3,}/g, '\n\n');
      const area = firstMatchingFocus(fullText);
      if (!area) continue;
      const author = String(post.author ?? '').trim();
      if (!author || author === '[deleted]' || author === 'AutoModerator') continue;
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
        identity: {
          platform: 'reddit',
          username: author,
          profile_url: `https://www.reddit.com/user/${encodeURIComponent(author)}`,
          possible_business: null,
        },
      });
      if (r.hot) hot = true;
    }
    await sleep(900);
  }
  return hot;
}

type HnItem = {
  title?: string;
  url?: string;
  text?: string;
  deleted?: boolean;
  dead?: boolean;
  by?: string;
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
    const by = item.by?.trim() ?? null;
    const r = await capturePainSignal({
      id: sid,
      source: 'hackernews',
      sourceUrl: url,
      title,
      content: body || title,
      focusAreaId: area.id,
      createdAt: new Date(),
      identity: {
        platform: 'hackernews',
        username: by,
        profile_url: by ? `https://news.ycombinator.com/user?id=${encodeURIComponent(by)}` : null,
        possible_business: null,
      },
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
      expansions: 'author_id',
      'user.fields': 'username',
    })}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      console.warn(`[ingest] Twitter HTTP ${response.status}`);
      continue;
    }
    const payload = (await response.json()) as {
      data?: { id: string; text: string; created_at?: string; author_id?: string }[];
      includes?: { users?: { id: string; username?: string }[] };
    };
    const userMap = new Map((payload.includes?.users ?? []).map((u) => [u.id, u]));
    const tweets = payload.data ?? [];
    for (const tw of tweets) {
      const text = plainTextFromHtmlish(tw.text);
      const area = firstMatchingFocus(text);
      if (!area) continue;
      const createdAt = tw.created_at ? new Date(tw.created_at) : new Date();
      const link = `https://twitter.com/i/web/status/${tw.id}`;
      const author = tw.author_id ? userMap.get(tw.author_id) : undefined;
      const uname = author?.username?.trim() ?? null;
      const r = await capturePainSignal({
        id: `tw:${tw.id}`,
        source: 'twitter',
        sourceUrl: link,
        title: text.slice(0, 300),
        content: text,
        focusAreaId: area.id,
        createdAt,
        identity: {
          platform: 'twitter',
          username: uname,
          profile_url: uname ? `https://twitter.com/${uname}` : link,
          possible_business: null,
        },
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
  user?: { login: string; html_url?: string };
};

function githubTitleLooksSevere(title: string): boolean {
  return /production|broken|checkout|payment|regression|critical|failing|down|not working|outage|sev[0-3]/i.test(
    title
  );
}

export async function fetchGitHubIssuesPain(): Promise<boolean> {
  const q =
    process.env.GITHUB_ISSUES_QUERY?.trim() ||
    'is:issue is:open is:public (label:bug OR label:regression OR label:performance)';
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=updated&per_page=20`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

  const minStarsRaw = process.env.GITHUB_MIN_STARS?.trim();
  const minStarsParsed = minStarsRaw === '' || minStarsRaw === undefined ? 5000 : Number.parseInt(minStarsRaw, 10);
  const minStars = Number.isFinite(minStarsParsed) ? Math.max(0, minStarsParsed) : 5000;
  const starsCache = new Map<string, number>();

  async function repoStargazers(repo: string): Promise<number> {
    if (starsCache.has(repo)) return starsCache.get(repo)!;
    const rr = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!rr.ok) {
      starsCache.set(repo, 0);
      return 0;
    }
    const j = (await rr.json()) as { stargazers_count?: number };
    const n = j.stargazers_count ?? 0;
    starsCache.set(repo, n);
    return n;
  }

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
    if (!githubTitleLooksSevere(title)) continue;
    const body = issue.body ? plainTextFromHtmlish(issue.body) : '';
    const fullText = `${title}\n\n${body}`;
    const area = firstMatchingFocus(fullText);
    if (!area) continue;
    const repoMatch = issue.repository_url.match(/\/repos\/([^/]+\/[^/]+)$/);
    const repo = repoMatch?.[1] ?? '';
    if (!repo) continue;
    const stars = await repoStargazers(repo);
    if (minStars > 0 && stars < minStars) {
      console.log(`[ingest] GitHub skip ${repo}#${issue.number} — stars ${stars} < ${minStars}`);
      continue;
    }
    const login = issue.user?.login?.trim() ?? null;
    const sid = `gh:${repo}:${issue.number}`.slice(0, 200);
    const r = await capturePainSignal({
      id: sid,
      source: 'github_issue',
      sourceUrl: issue.html_url,
      title,
      content: body.slice(0, 20000) || title,
      focusAreaId: area.id,
      createdAt: new Date(),
      identity: {
        platform: 'github_issue',
        username: login,
        profile_url: login ? `https://github.com/${login}` : null,
        possible_business: repo,
      },
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

/**
 * Fetches public listings and upserts `pain_signals` (deduplicated by content hash).
 */
export async function runIngest(): Promise<void> {
  let anyHot = false;
  if (await fetchRedditSearchPain()) anyHot = true;

  if (await fetchHackerNewsPain()) anyHot = true;
  if (await fetchTwitterPain()) anyHot = true;
  if (await fetchGitHubIssuesPain()) anyHot = true;

  if (anyHot) {
    const copy = 'Pain Intel: at least one signal scored intensity > 80 in this run.';
    console.log(`[ingest/alert] ${copy}`);
    await ntfyAlert(copy);
  }
}
