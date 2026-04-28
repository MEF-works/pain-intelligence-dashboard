'use client';

import * as React from 'react';
import { Layers, Radio } from 'lucide-react';
import { FOCUS_AREAS } from '@/lib/constants/focus-areas';
import { cn } from '@/lib/utils';

type ByFocus = { focusArea: string; count: number };
type BySource = { source: string; count: number };

export type SnapshotStats = {
  total: number;
  byFocus: ByFocus[];
  bySource: BySource[];
};

const SOURCE_STYLES: Record<string, string> = {
  reddit: 'border-orange-500/35 bg-orange-950/30 text-orange-100',
  google_dork: 'border-violet-500/40 bg-violet-950/35 text-violet-100',
  hackernews: 'border-amber-500/35 bg-amber-950/30 text-amber-100',
  twitter: 'border-sky-500/35 bg-sky-950/30 text-sky-100',
  github_issue: 'border-emerald-500/35 bg-emerald-950/25 text-emerald-100',
  job_rss: 'border-cyan-500/35 bg-cyan-950/25 text-cyan-100',
};

const FOCUS_BAR: Record<string, string> = {
  transaction_gap: 'bg-rose-500/85',
  false_health: 'bg-cyan-500/80',
  blast_radius: 'bg-orange-500/85',
  api_drift: 'bg-violet-500/80',
  support_failure: 'bg-emerald-500/75',
};

function focusLabel(id: string): string {
  const a = Object.values(FOCUS_AREAS).find((x) => x.id === id);
  return a?.label ?? id.replace(/_/g, ' ');
}

function sourceLabel(raw: string): string {
  return raw.replace(/_/g, ' ');
}

interface DashboardSnapshotProps {
  stats: SnapshotStats | null;
  loading: boolean;
}

/**
 * Replaces the old horizontal bar chart: same data, clearer labels + share of volume.
 */
export function DashboardSnapshot({ stats, loading }: DashboardSnapshotProps) {
  const total = stats?.total ?? 0;
  const byFocus = React.useMemo(() => {
    const rows = [...(stats?.byFocus ?? [])];
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [stats?.byFocus]);

  const bySource = React.useMemo(() => {
    const rows = [...(stats?.bySource ?? [])];
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [stats?.bySource]);

  if (loading) {
    return (
      <section
        className="rounded-lg border border-zinc-800/90 bg-gradient-to-b from-zinc-900/40 to-[#0a0a0c] p-4 min-h-[220px] flex items-center justify-center"
        aria-busy="true"
      >
        <p className="text-[11px] font-mono text-zinc-500">Loading snapshot…</p>
      </section>
    );
  }

  if (!stats || (byFocus.length === 0 && bySource.length === 0)) {
    return (
      <section className="rounded-lg border border-zinc-800/90 bg-gradient-to-b from-zinc-900/40 to-[#0a0a0c] p-4 min-h-[220px] flex items-center justify-center">
        <p className="text-[11px] font-mono text-zinc-600">No rows yet — run ingest.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-800/90 bg-gradient-to-b from-zinc-900/50 via-[#0d0d10] to-[#08080a] p-4 shadow-inner shadow-black/40">
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-zinc-800/80">
        <h2 className="text-[11px] font-mono uppercase tracking-widest text-zinc-300 flex items-center gap-2">
          <Layers size={14} className="text-violet-400/90 shrink-0" aria-hidden />
          Inbox snapshot
        </h2>
        <span className="text-[9px] font-mono text-zinc-600 tabular-nums">
          {total} in DB · shares below
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-[9px] font-mono uppercase tracking-wider text-amber-500/90 mb-2 flex items-center gap-1.5">
            <Radio size={11} className="opacity-80" aria-hidden />
            By source
          </h3>
          <ul className="space-y-2">
            {bySource.map((row) => {
              const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
              const style = SOURCE_STYLES[row.source] ?? 'border-zinc-600 bg-zinc-900/50 text-zinc-200';
              return (
                <li
                  key={row.source}
                  className={cn(
                    'rounded-md border px-2.5 py-2 flex flex-col gap-1.5',
                    style
                  )}
                >
                  <div className="flex justify-between gap-2 items-baseline">
                    <span className="text-[11px] font-mono font-medium capitalize truncate">
                      {sourceLabel(row.source)}
                    </span>
                    <span className="text-xs font-mono font-bold tabular-nums shrink-0">
                      {row.count}{' '}
                      <span className="text-[9px] font-normal text-white/50">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-black/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-white/25"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="text-[9px] font-mono uppercase tracking-wider text-cyan-500/90 mb-2">
            By focus (pain bucket)
          </h3>
          <ul className="space-y-2.5">
            {byFocus.map((row) => {
              const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
              const bar = FOCUS_BAR[row.focusArea] ?? 'bg-zinc-500/70';
              return (
                <li key={row.focusArea}>
                  <div className="flex justify-between gap-2 text-[10px] mb-1">
                    <span className="font-sans text-zinc-200 leading-tight pr-2 line-clamp-2">
                      {focusLabel(row.focusArea)}
                    </span>
                    <span className="font-mono text-zinc-400 tabular-nums shrink-0">
                      {row.count}{' '}
                      <span className="text-zinc-600">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-950 border border-zinc-800/80 overflow-hidden">
                    <div className={cn('h-full rounded-full transition-[width]', bar)} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
