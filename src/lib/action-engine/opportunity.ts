import { GoogleGenAI } from '@google/genai';

/** Stored in DB + API */
export type ActionTypeStored = 'direct_outreach' | 'research_deeper' | 'ignore';

export type OpportunityRowFields = {
  painSummary: string;
  likelyRootIssue: string;
  opportunityAngle: string;
  businessImpact: string;
  confidenceScore: number;
  actionType: ActionTypeStored;
};

const ROOT_BY_FOCUS: Record<string, string> = {
  transaction_gap:
    'Payment, checkout, or money reconciliation path is unreliable or inconsistent with what customers experience.',
  false_health:
    'Monitoring/analytics/dashboards report success while real customer or money outcomes disagree.',
  blast_radius:
    'A deployment, upgrade, or dependency change widened blast radius and broke production behavior.',
  api_drift:
    'External APIs, webhooks, or integrations drifted (versions, auth, payloads, rate limits).',
  support_failure:
    'Vendor or platform support is failing to resolve blocking issues, increasing churn risk.',
};

const ANGLE_BY_FOCUS: Record<string, string> = {
  transaction_gap:
    'Offer a fast audit of checkout → gateway → webhook → accounting reconciliation with a concrete fix path.',
  false_health:
    'Map “green dashboards” to cash/customer truth—instrumentation + reconciliation + executive-readable proof.',
  blast_radius:
    'Stabilize upgrades with rollback, staging parity, and regression checks around the failing surface area.',
  api_drift:
    'Harden integrations (signing, retries, idempotency) and own fallbacks when vendors change behavior.',
  support_failure:
    'Become the accountable operator: triage, workaround, and migrate risk off vendors that ghost support.',
};

function oneSentenceGist(text: string, maxLen = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'Operational pain signal without enough context.';
  const slice = t.slice(0, maxLen);
  const end = slice.lastIndexOf('. ');
  const cut = end > 40 ? slice.slice(0, end + 1) : `${slice}${slice.endsWith('.') ? '' : '…'}`;
  return cut.trim();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Boost / penalize intensity based on monetization + business context vs vague tech-only noise. */
export function adjustIntensityMonetization(baseIntensity: number, text: string): number {
  const lower = text.toLowerCase();
  let adj = baseIntensity;

  const monetization =
    /money|revenue|sales|conversion|customer|checkout|stripe|paypal|chargeback|refund|lost\s+\$|\$\d|mrr|arr|profit/i.test(
      lower
    );
  const users =
    /users|sign\s*up|signup|traffic|visitors|subscribers|churn|retention|leads/i.test(lower);
  const frustration =
    /frustrated|desperate|weeks?\s+trying|months?\s+of|hours wasted|losing money/i.test(lower);
  const scaling = /scaling|scale\b|bottleneck|can't handle volume|too much traffic/i.test(lower);
  const vagueTechOnly =
    text.length < 95 &&
    !monetization &&
    !users &&
    /error|exception|stack|npm|typescript|undefined is not/i.test(lower);

  if (monetization) adj += 10;
  if (users) adj += 6;
  if (frustration) adj += 5;
  if (scaling) adj += 4;
  if (vagueTechOnly) adj -= 14;

  return Math.min(100, Math.max(0, Math.round(adj)));
}

function heuristicConfidence(text: string, focusAreaId: string, intensity: number): number {
  const lower = text.toLowerCase();
  let c = 0.52;

  if (text.length > 220) c += 0.08;
  if (text.length > 600) c += 0.04;

  if (/money|revenue|\$\d|chargeback|refund|stripe|paypal|checkout|lost sales/i.test(lower)) c += 0.12;
  if (/customer|user|conversion|signup|traffic|churn|cart/i.test(lower)) c += 0.06;
  if (/frustrated|desperate|weeks|ignored|useless support|no response/i.test(lower)) c += 0.06;
  if (intensity >= 72) c += 0.06;
  if (intensity >= 88) c += 0.04;

  if (text.length < 70 && !/money|revenue|customer|checkout|stripe|sales/i.test(lower)) c -= 0.18;
  if (/^help\b|^how do i\b|^anyone know\b/i.test(lower) && text.length < 120) c -= 0.1;

  if (focusAreaId === 'transaction_gap' || focusAreaId === 'false_health') c += 0.03;

  return clamp01(c);
}

function classifyAction(
  confidence: number,
  intensity: number,
  text: string
): ActionTypeStored {
  const lower = text.toLowerCase();
  const strongBiz =
    /money|revenue|customer|checkout|stripe|paypal|sales|conversion|churn|refund|users\b/i.test(
      lower
    );

  if (confidence >= 0.72 && (strongBiz || intensity >= 68)) return 'direct_outreach';
  if (confidence >= 0.45) return 'research_deeper';
  return 'ignore';
}

function businessImpactLine(text: string, focusAreaId: string): string {
  const lower = text.toLowerCase();
  if (/money|revenue|\$\d|refund|chargeback|lost sales|mrr|arr/i.test(lower)) {
    return 'Direct revenue or cash-flow risk; leakage compounds daily until reconciled.';
  }
  if (/customer|churn|trust|brand|review|angry/i.test(lower)) {
    return 'Trust and retention risk—customers may churn or amplify negative word-of-mouth.';
  }
  if (/time|weeks|months|hours/i.test(lower)) {
    return 'Operational drag: leadership time burned and opportunity cost while the issue persists.';
  }
  return `Operational risk concentrated in ${focusAreaId.replace(/_/g, ' ')}—delays shipping and compounds rework.`;
}

/** Core heuristic opportunity fields (always available offline). */
export function deriveOpportunityHeuristic(input: {
  title: string | null;
  content: string;
  focusAreaId: string;
  intensity: number;
  source: string;
}): OpportunityRowFields {
  const title = (input.title ?? '').trim();
  const body = input.content.trim();
  const blob = `${title}\n\n${body}`.trim();
  const pain_summary = oneSentenceGist(blob || body || title || 'Undescribed pain signal.');

  const likely_root_issue =
    ROOT_BY_FOCUS[input.focusAreaId] ??
    'Operational or technical failure impacting customer-visible outcomes.';

  const opportunity_angle =
    ANGLE_BY_FOCUS[input.focusAreaId] ??
    'Offer a scoped diagnostic → remediation plan with measurable business outcomes.';

  let conf = heuristicConfidence(blob, input.focusAreaId, input.intensity);
  if (input.source === 'google_dork') {
    conf = clamp01(conf + 0.18);
  }
  const action_type = classifyAction(conf, input.intensity, blob);

  return {
    painSummary: pain_summary,
    likelyRootIssue: likely_root_issue,
    opportunityAngle: opportunity_angle,
    businessImpact: businessImpactLine(blob, input.focusAreaId),
    confidenceScore: Math.round(conf * 1000) / 1000,
    actionType: action_type,
  };
}

type GeminiJson = {
  pain_summary?: string;
  likely_root_issue?: string;
  opportunity_angle?: string;
  business_impact?: string;
  confidence_score?: number;
  action_type?: string;
};

function normalizeActionType(raw: string | undefined): ActionTypeStored | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s+/g, '_');
  if (s === 'direct_outreach' || s === 'direct-outreach') return 'direct_outreach';
  if (s === 'research_deeper' || s === 'research-deeper' || s === 'research') return 'research_deeper';
  if (s === 'ignore') return 'ignore';
  return null;
}

/** Optional Gemini pass to sharpen summaries (uses GEMINI_API_KEY). */
async function refineWithGemini(
  heuristic: OpportunityRowFields,
  rawTitle: string | null,
  rawBody: string,
  focusAreaId: string
): Promise<OpportunityRowFields> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.ACTION_ENGINE_GEMINI === 'false') {
    return heuristic;
  }

  const genAI = new GoogleGenAI({ apiKey });
  const prompt = `You are an analyst turning noisy public posts into operator-grade opportunity notes.

Return ONLY valid JSON (no markdown fence) with keys:
"pain_summary" (one sentence),
"likely_root_issue" (one sentence),
"opportunity_angle" (one sentence: where an external consultant/builder steps in),
"business_impact" (one sentence: revenue, risk, inefficiency, or opportunity),
"confidence_score" (number 0-1),
"action_type" (exactly one of: "direct_outreach", "research_deeper", "ignore").

Optimize for clarity of action, not volume. Be specific.

FOCUS_AREA: ${focusAreaId}
TITLE: ${rawTitle ?? ''}
BODY (truncated): ${rawBody.slice(0, 6000)}

HEURISTIC_DRAFT_JSON:
${JSON.stringify(heuristic)}`;

  try {
    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });
    const text = result.text?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristic;
    const parsed = JSON.parse(jsonMatch[0]) as GeminiJson;
    const at = normalizeActionType(parsed.action_type);
    const cs =
      typeof parsed.confidence_score === 'number' && Number.isFinite(parsed.confidence_score)
        ? clamp01(parsed.confidence_score)
        : heuristic.confidenceScore;

    return {
      painSummary: (parsed.pain_summary ?? heuristic.painSummary).slice(0, 500),
      likelyRootIssue: (parsed.likely_root_issue ?? heuristic.likelyRootIssue).slice(0, 500),
      opportunityAngle: (parsed.opportunity_angle ?? heuristic.opportunityAngle).slice(0, 500),
      businessImpact: (parsed.business_impact ?? heuristic.businessImpact).slice(0, 500),
      confidenceScore: Math.round(cs * 1000) / 1000,
      actionType: at ?? heuristic.actionType,
    };
  } catch {
    return heuristic;
  }
}

/** Full pipeline: heuristic → optional Gemini refinement. */
export async function buildOpportunityFields(input: {
  title: string | null;
  content: string;
  focusAreaId: string;
  intensity: number;
  source: string;
}): Promise<OpportunityRowFields> {
  const h = deriveOpportunityHeuristic(input);
  return refineWithGemini(h, input.title, input.content, input.focusAreaId);
}

/** Skip storing ultra-low-value noise (clarity over volume). */
export function shouldDiscardSignal(fields: OpportunityRowFields): boolean {
  return fields.actionType === 'ignore' && fields.confidenceScore < 0.24;
}
