/** Pipeline states stored in `pain_signals.status` */
export type SignalStatus = 'new' | 'outreached' | 'paid' | 'dead';

/** Row shape used by the dashboard feed (from GET /api/signals). */
export interface FeedSignal {
  id: string;
  source: string;
  sourceUrl: string;
  title: string | null;
  text: string;
  timestamp: string;
  focusArea: string | null;
  intensity: number;
  status: string;
  /** ISO time of last scrutinize proof-of-life check */
  lastVerifiedAt: string | null;
  /** Action Engine (may be null for legacy rows) */
  painSummary: string | null;
  likelyRootIssue: string | null;
  opportunityAngle: string | null;
  businessImpact: string | null;
  confidenceScore: number | null;
  /** direct_outreach | research_deeper | ignore */
  actionType: string | null;
}
