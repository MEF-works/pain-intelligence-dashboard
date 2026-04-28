'use client';

import * as React from 'react';
import type { FeedSignal } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Crosshair, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
function actionRank(actionType: string | null | undefined): number {
  if (actionType === 'direct_outreach') return 3;
  if (actionType === 'research_deeper') return 2;
  return 1;
}

/** Next three monetizable moves — ranked by action type, then confidence × intensity. */
export function pickTopActions(signals: FeedSignal[]): FeedSignal[] {
  const ranked = [...signals].sort((a, b) => {
    const ra = actionRank(a.actionType);
    const rb = actionRank(b.actionType);
    if (rb !== ra) return rb - ra;
    const sa = (a.confidenceScore ?? 0) * (a.intensity || 0);
    const sb = (b.confidenceScore ?? 0) * (b.intensity || 0);
    return sb - sa;
  });
  return ranked.slice(0, 3);
}

interface TopActionsProps {
  signals: FeedSignal[];
}

export function TopActions({ signals }: TopActionsProps) {
  const top = React.useMemo(() => pickTopActions(signals), [signals]);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [outreachById, setOutreachById] = React.useState<Record<string, string>>({});
  const [errById, setErrById] = React.useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const runOutreach = async (id: string) => {
    setLoadingId(id);
    setErrById((e) => ({ ...e, [id]: '' }));
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { text?: string };
      setOutreachById((o) => ({ ...o, [id]: data.text ?? '' }));
    } catch (e) {
      setErrById((er) => ({
        ...er,
        [id]: e instanceof Error ? e.message : 'Failed',
      }));
    } finally {
      setLoadingId(null);
    }
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (top.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950/80 to-[#0a0a0a] p-5 mb-6 shadow-lg shadow-black/40">
        <h2 className="text-[11px] font-mono uppercase text-rose-400 tracking-widest flex items-center gap-2 mb-2">
          <Crosshair size={14} />
          Top actions (next 3 moves)
        </h2>
        <p className="text-[11px] font-mono text-zinc-500">
          No ranked signals yet — run ingest after deploy, or widen focus keywords / sources.
        </p>
      </section>
    );
  }

  const rankShell = [
    'border-l-4 border-l-rose-500/90 bg-gradient-to-br from-rose-950/20 via-zinc-950/80 to-zinc-950 border border-zinc-800/80',
    'border-l-4 border-l-violet-500/90 bg-gradient-to-br from-violet-950/20 via-zinc-950/80 to-zinc-950 border border-zinc-800/80',
    'border-l-4 border-l-cyan-500/85 bg-gradient-to-br from-cyan-950/15 via-zinc-950/80 to-zinc-950 border border-zinc-800/80',
  ] as const;

  return (
    <section className="rounded-xl border border-zinc-700/50 bg-gradient-to-b from-zinc-900/30 via-[#0c0c0f] to-[#060606] p-5 mb-6 shadow-xl shadow-black/50 ring-1 ring-white/[0.04]">
      <h2 className="text-[11px] font-mono uppercase text-rose-400 tracking-widest flex items-center gap-2 mb-1">
        <Crosshair size={14} />
        Top actions (next 3 moves)
      </h2>
      <p className="text-[10px] font-mono text-zinc-500 mb-4 max-w-3xl leading-relaxed">
        Highest-ranked outreach targets — sorted by action type, then confidence × intensity. Each card: lead →
        diagnosis → angle → button.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {top.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              'rounded-lg p-3.5 flex flex-col gap-2 min-h-[188px] shadow-md shadow-black/30',
              rankShell[i] ?? rankShell[2]
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-mono font-bold text-zinc-400 tabular-nums tracking-tight">
                #{i + 1}
              </span>
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-500 hover:text-[#FF3E99] flex items-center gap-0.5 shrink-0"
              >
                Source
                <ExternalLink size={10} />
              </a>
            </div>
            <h3 className="text-[13px] font-sans font-medium text-zinc-50 leading-snug line-clamp-3 tracking-tight">
              {s.title || s.text.slice(0, 120)}
            </h3>
            <div className="flex-1 space-y-1">
              <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">Pain</p>
              <p className="text-[10px] font-mono text-zinc-300 leading-relaxed line-clamp-3">
                {s.painSummary || '—'}
              </p>
            </div>
            <div className="border-t border-zinc-800/80 pt-2 space-y-1">
              <p className="text-[8px] font-mono uppercase tracking-wider text-fuchsia-400/80">Angle</p>
              <p className="text-[10px] text-fuchsia-100/90 leading-snug line-clamp-3 font-sans">
                {s.opportunityAngle || '—'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => void runOutreach(s.id)}
                disabled={loadingId !== null}
                className="px-2 py-1 text-[9px] font-mono uppercase bg-[#FF3E3E]/25 text-[#FF3E3E] border border-[#FF3E3E]/50 rounded hover:bg-[#FF3E3E]/35 disabled:opacity-40"
              >
                {loadingId === s.id ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Gen
                  </span>
                ) : (
                  '1-click outreach'
                )}
              </button>
              {outreachById[s.id] && (
                <button
                  type="button"
                  onClick={() => copy(s.id, outreachById[s.id])}
                  className="px-2 py-1 text-[9px] font-mono uppercase border border-zinc-700 rounded text-zinc-400 hover:text-white flex items-center gap-1"
                >
                  {copiedId === s.id ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                  {copiedId === s.id ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {errById[s.id] && (
              <p className="text-[10px] text-red-400 font-mono">{errById[s.id]}</p>
            )}
            {outreachById[s.id] && (
              <p className="text-[11px] text-zinc-300 leading-snug border-t border-zinc-900 pt-2 whitespace-pre-wrap">
                {outreachById[s.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
