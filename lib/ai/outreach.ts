import { GoogleGenAI } from '@google/genai';

type SignalForOutreach = {
  content: string;
  focusArea: string | null;
  painSummary: string | null;
  opportunityAngle: string | null;
  businessImpact: string | null;
  /** When `google_dork`, bridge copy references public failure pages without naming the finder. */
  source?: string | null;
  title?: string | null;
};

/**
 * One-sentence, money/trust–framed bridge. Do not name platforms or "how you found them."
 */
export async function generateTargetedBridge(signal: SignalForOutreach) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const genAI = new GoogleGenAI({ apiKey });
  const structured = [
    signal.painSummary ? `PAIN_SUMMARY: ${signal.painSummary}` : '',
    signal.opportunityAngle ? `OPPORTUNITY_ANGLE: ${signal.opportunityAngle}` : '',
    signal.businessImpact ? `BUSINESS_IMPACT: ${signal.businessImpact}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const isGoogleDork = signal.source === 'google_dork';

  const dorkBlock = isGoogleDork
    ? `
SOURCE_MODE: google_dork (public failure page indexed by search — never say Google, search, dork, or how it was found).
TITLE_HINT: ${signal.title ?? '(none)'}

STRUCTURE for this mode (single sentence): Open by naming the specific visible failure (from TITLE_HINT and RAW_SNIPPET), e.g. critical WordPress error, database connection failure, or WooCommerce/payment-layer failure — then state that you specialize in structural WordPress recovery and database reconciliation (use that phrase or clear equivalent).
Concept spine to preserve: "I noticed your site is currently displaying [Specific Error]; I specialize in structural WordPress recovery and database reconciliation."
Compress into ONE fluent sentence (no brackets).`
    : '';

  const prompt = `You are a Forensic Software Architect specializing in sovereign stacks and local-first systems. Write ONE cold-outreach opening line to a business owner.

Use the structured analysis below as primary facts (not raw scraping). Supplement with RAW_SNIPPET only for concrete nouns if needed.

${structured || '(No structured analysis — infer from raw snippet.)'}

RAW_SNIPPET (never name Reddit, Twitter, forums, or data source):
"""${signal.content.slice(0, 8000)}"""
FOCUS: ${signal.focusArea ?? 'unknown'}
${dorkBlock}

STRUCTURE (single sentence): [Specific symptom observed in their situation] + [financial risk or trust gap] + [the sovereign / local-first solution outcome].

RULES:
- Output EXACTLY ONE English sentence, no line breaks, no subject line, no pleasantries.
- Do NOT say Reddit, Twitter, forum, "I saw your post", Google, search engine, or any data source.
- FORBIDDEN phrases (never use): "I can help you fix this", "I'm here to help", "let me help", "happy to help", "reach out", or any generic offer of help without technical specificity.
- Sound like insight from diagnosis, not from scraping.
- Be concrete on symptoms and money/trust impact. Prefer outcomes like ledger reconciliation, offline-capable flows, owning data locally, durable webhooks, recoverable payment paths.

Example tone (do not copy verbatim): "Your checkout is dropping 15% of mobile orders due to a v4 webhook mismatch; I specialize in local-first payment reconciliation to reconnect that money path."

If you cannot be specific, stay conservative but still one sentence with a clear technical thread and revenue/trust angle.`;

  const result = await genAI.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });

  return result.text?.trim() ?? '';
}
