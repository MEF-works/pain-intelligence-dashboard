/**
 * Radar filters: keep signals that look like real operators in pain,
 * not SEO guides, job posts, or generic documentation.
 */

export type SignalRadarInput = {
  source: string;
  sourceUrl: string;
  title: string | null;
  /** Full body used for triggers (title + content). */
  text: string;
};

export type SignalIdentity = {
  username: string | null;
  profile_url: string | null;
  platform: string;
  possible_business: string | null;
};

const JUNK_HOST_PARTS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'kinsta.com',
  'godaddy.com',
  'teamupdraft',
  'ionos.com',
  'wix.com',
  'shopify.com/blog',
  'woocommerce.com/document',
  'woocommerce.com/posts',
  'wordpress.org/support/article',
  'wordpress.org/support/topic',
  'reddit.com/r/wordpress/comments', // often generic threads — still allow other subs
  't.co/',
  'google.com/search',
  'bing.com',
  'cloudflare.com/learning',
  'developer.mozilla.org',
  'stackoverflow.com/questions/tagged', // tag-only listing noise
] as const;

const JUNK_PATH_HINTS = ['/blog/', '/guide/', '/how-to', '/tutorials/', '/docs/', '/documentation'] as const;

/** SEO / edu / platform help — not a capturable “person in pain” lead for this product. */
export function isJunkUrl(sourceUrl: string, title: string | null): boolean {
  const u = sourceUrl.toLowerCase();
  const t = (title ?? '').toLowerCase();
  for (const h of JUNK_HOST_PARTS) {
    if (u.includes(h)) return true;
  }
  for (const p of JUNK_PATH_HINTS) {
    if (u.includes(p)) return true;
  }
  if (/\b(fixed|tutorial|guide|how to fix|learn how)\b/i.test(t)) return true;
  return false;
}

const OWNER_SOURCES = new Set(['reddit', 'twitter', 'github_issue', 'hackernews']);

/** Google organic hits can be valid only when they look like a site outage, not a publisher article. */
function googleDorkLooksReachable(sourceUrl: string, text: string): boolean {
  if (isJunkUrl(sourceUrl, text)) return false;
  const lower = text.toLowerCase();
  const host = (() => {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const publisherHosts = [
    'wordpress.org',
    'youtube.com',
    'facebook.com',
    'kinsta.com',
    'godaddy.com',
    'ionos.com',
    'wix.com',
    'shopify.com',
    'woocommerce.com',
    'github.com',
  ];
  if (publisherHosts.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  // First-person / outage page language
  if (
    /\b(my|our)\s+(site|store|shop|cart|checkout|customers|sales|wp|wordpress)\b/i.test(lower) ||
    /\b(there has been a critical error|database connection)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

export function hasOwnerPlatform(input: SignalRadarInput): boolean {
  if (OWNER_SOURCES.has(input.source)) return true;
  if (input.source === 'google_dork') {
    return googleDorkLooksReachable(input.sourceUrl, `${input.title ?? ''}\n${input.text}`);
  }
  return false;
}

const PROBLEM_TRIGGERS = [
  'not working',
  'broken',
  'issue',
  'problem',
  'help',
  'error',
  'failing',
  "can't",
  'cannot',
  'cant ',
  'stuck',
  ' is down',
  ' went down',
  'lost ',
  'failed',
  'crash',
  'urgent',
  'desperate',
  'anyone else',
  'stopped working',
  'no longer',
] as const;

export function expressesProblem(text: string): boolean {
  const lower = text.toLowerCase();
  return PROBLEM_TRIGGERS.some((t) => lower.includes(t));
}

export function isBuyerContext(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.includes('my') && !lower.includes('our')) return false;
  return (
    lower.includes('customer') ||
    lower.includes('sales') ||
    lower.includes('user') ||
    lower.includes('store') ||
    lower.includes('site') ||
    lower.includes('checkout') ||
    lower.includes('cart') ||
    lower.includes('revenue') ||
    lower.includes('order')
  );
}

export function computeBuyerScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  if (/\bmy\b/.test(lower) || /\bour\b/.test(lower)) score += 2;
  if (lower.includes('customer')) score += 3;
  if (lower.includes('sales')) score += 3;
  if (lower.includes('lost')) score += 2;
  if (lower.includes('help')) score += 1;
  if (lower.includes('checkout') || lower.includes('payment')) score += 2;
  if (lower.includes('revenue') || lower.includes('money')) score += 2;
  return Math.min(20, score);
}

/** Reddit-only: require first-person anchor to cut listicle spam. */
export function passesRedditFirstPerson(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('my ') ||
    lower.includes('my\n') ||
    lower.includes(' i ') ||
    lower.includes("i'm") ||
    lower.includes('our ')
  );
}

export type RadarResult = {
  ok: boolean;
  reason?: string;
  buyerScore: number;
  priority: 'high' | 'low';
  identity: SignalIdentity;
};

export function qualifySignal(
  input: SignalRadarInput,
  identity: Partial<SignalIdentity> & { platform: string }
): RadarResult {
  const blob = `${input.title ?? ''}\n${input.text}`.trim();
  if (isJunkUrl(input.sourceUrl, input.title)) {
    return { ok: false, reason: 'junk_url_or_help_content', buyerScore: 0, priority: 'low', identity: finalizeIdentity(identity) };
  }
  if (!hasOwnerPlatform(input)) {
    return { ok: false, reason: 'no_identity_platform', buyerScore: 0, priority: 'low', identity: finalizeIdentity(identity) };
  }
  if (!expressesProblem(blob)) {
    return { ok: false, reason: 'no_problem_language', buyerScore: 0, priority: 'low', identity: finalizeIdentity(identity) };
  }
  if (input.source === 'reddit' && !passesRedditFirstPerson(blob)) {
    return { ok: false, reason: 'reddit_not_first_person', buyerScore: 0, priority: 'low', identity: finalizeIdentity(identity) };
  }
  const buyerScore = computeBuyerScore(blob);
  const priority: 'high' | 'low' = isBuyerContext(blob) || buyerScore >= 6 ? 'high' : 'low';
  return { ok: true, buyerScore, priority, identity: finalizeIdentity(identity) };
}

function finalizeIdentity(partial: Partial<SignalIdentity> & { platform: string }): SignalIdentity {
  return {
    username: partial.username ?? null,
    profile_url: partial.profile_url ?? null,
    platform: partial.platform,
    possible_business: partial.possible_business ?? null,
  };
}
