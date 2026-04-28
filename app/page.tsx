'use client';

import * as React from 'react';
import { motion } from 'motion/react';
import { FOCUS_AREAS } from '@/lib/constants/focus-areas';
import type { FeedSignal } from '@/lib/types';
import { DashboardSnapshot } from '@/components/DashboardSnapshot';
import { SignalFeed } from '@/components/SignalFeed';
import { TopActions } from '@/components/TopActions';
import { StatCard } from '@/components/StatCard';
import { cn, downloadSignalsCsv } from '@/lib/utils';
import {
  Skull,
  Zap,
  Search,
  ShieldAlert,
  Activity,
  Target,
  Clock,
  Filter,
  Download,
  EyeOff,
  RefreshCw,
  HeartPulse,
} from 'lucide-react';

type StatsPayload = {
  total: number;
  highValueLeads: number;
  lastSignalAt: string | null;
  byFocus: { focusArea: string; count: number }[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
};

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedFocusAreas, setSelectedFocusAreas] = React.useState<string[]>([]);
  const [hideDead, setHideDead] = React.useState(true);
  const [actionableOnly, setActionableOnly] = React.useState(false);
  const [dorkingOnly, setDorkingOnly] = React.useState(false);
  const [feedSignals, setFeedSignals] = React.useState<FeedSignal[]>([]);
  const [stats, setStats] = React.useState<StatsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [healthOk, setHealthOk] = React.useState<boolean | null>(null);

  const refetch = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => {
        if (!cancelled) setHealthOk(r.ok);
      })
      .catch(() => {
        if (!cancelled) setHealthOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sigRes, stRes] = await Promise.all([
          fetch('/api/signals'),
          fetch('/api/stats'),
        ]);
        if (!sigRes.ok) throw new Error(await sigRes.text());
        if (!stRes.ok) throw new Error(await stRes.text());
        const sJson = (await sigRes.json()) as { signals: Record<string, unknown>[] };
        const tJson = (await stRes.json()) as StatsPayload;
        if (cancelled) return;
        const mapped: FeedSignal[] = sJson.signals.map((s) => ({
          id: String(s.id),
          source: String(s.source),
          sourceUrl: String(s.sourceUrl),
          title: s.title != null ? String(s.title) : null,
          text: [s.title, s.content].filter(Boolean).join('\n\n'),
          timestamp: String(s.createdAt),
          focusArea: s.focusArea != null ? String(s.focusArea) : null,
          intensity: Number(s.intensity) || 0,
          status: String(s.status ?? 'new'),
          lastVerifiedAt:
            s.lastVerifiedAt != null && s.lastVerifiedAt !== ''
              ? String(s.lastVerifiedAt)
              : null,
          painSummary: s.painSummary != null ? String(s.painSummary) : null,
          likelyRootIssue: s.likelyRootIssue != null ? String(s.likelyRootIssue) : null,
          opportunityAngle: s.opportunityAngle != null ? String(s.opportunityAngle) : null,
          businessImpact: s.businessImpact != null ? String(s.businessImpact) : null,
          confidenceScore:
            s.confidenceScore != null && s.confidenceScore !== ''
              ? Number(s.confidenceScore)
              : null,
          actionType: s.actionType != null ? String(s.actionType) : null,
        }));
        setFeedSignals(mapped);
        setStats(tJson);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filteredSignals = React.useMemo(() => {
    return feedSignals.filter((signal) => {
      if (hideDead && signal.status === 'dead') return false;
      if (actionableOnly) {
        const conf = signal.confidenceScore ?? 0;
        const at = signal.actionType ?? '';
        if (!(conf > 0.7 && at === 'direct_outreach')) return false;
      }
      if (dorkingOnly && signal.source !== 'google_dork') return false;
      const hay = `${signal.text} ${signal.title ?? ''}`.toLowerCase();
      const q = searchQuery === '' || hay.includes(searchQuery.toLowerCase());
      const f =
        selectedFocusAreas.length === 0 ||
        (signal.focusArea != null && selectedFocusAreas.includes(signal.focusArea));
      return q && f;
    });
  }, [feedSignals, searchQuery, selectedFocusAreas, hideDead, actionableOnly, dorkingOnly]);

  const killShotSignals = React.useMemo(() => {
    return feedSignals.filter((s) => !(hideDead && s.status === 'dead'));
  }, [feedSignals, hideDead]);

  const toggleFocus = (id: string) => {
    setSelectedFocusAreas((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-[#050505] text-[#E0E0E0] p-4 border-4 border-[#1A1A1A]">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"
        aria-hidden
      />
      <div className="scanline pointer-events-none" />

      <header className="flex flex-col border-b border-[#333] pb-3 mb-6 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 bg-[#FF3E3E] rounded-sm flex items-center justify-center shadow-[0_0_15px_rgba(255,62,62,0.4)]">
              <Skull className="text-black" size={20} />
            </div>
            <h1 className="text-xl font-mono font-bold tracking-tighter uppercase">
              Sovereign <span className="text-[#FF3E3E]">Pain intel</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setHideDead((v) => !v)}
              className={cn(
                'px-2 py-1 text-[10px] font-mono border rounded flex items-center gap-1',
                hideDead ? 'bg-zinc-800 border-zinc-600' : 'bg-[#1a0a0a] border-zinc-700'
              )}
            >
              <EyeOff size={12} />
              {hideDead ? 'Hiding dead' : 'Show dead'}
            </button>
            <button
              type="button"
              onClick={() => setActionableOnly((v) => !v)}
              className={cn(
                'px-2 py-1 text-[10px] font-mono border rounded flex items-center gap-1',
                actionableOnly ? 'bg-[#FF3E99]/25 border-[#FF3E99]/50 text-[#FF3E99]' : 'bg-zinc-900 border-zinc-700 text-zinc-500'
              )}
              title="confidence &gt; 0.7 and action_type = direct_outreach"
            >
              Actionable only
            </button>
            <button
              type="button"
              onClick={() => downloadSignalsCsv(filteredSignals)}
              className="px-2 py-1 text-[10px] font-mono border border-zinc-700 bg-zinc-900 rounded flex items-center gap-1 hover:bg-zinc-800"
            >
              <Download size={12} />
              Download leads (csv)
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={loading}
              className="px-2 py-1 text-[10px] font-mono border border-zinc-600 bg-zinc-900 rounded flex items-center gap-1 hover:bg-zinc-800 disabled:opacity-40"
              title="Reload signals + stats from SQLite"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <div className="flex items-center gap-1 px-2 py-1 bg-[#FF3E3E] text-xs font-mono font-bold text-black">
              LIVE DB
              {healthOk === true && (
                <HeartPulse size={12} className="text-black/80" aria-hidden />
              )}
              {healthOk === false && (
                <span className="text-[9px] font-normal normal-case text-black/70">api?</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-zinc-950/50 p-2 border border-zinc-800 rounded">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black border border-zinc-800 flex-1 min-w-[200px]">
            <Search size={14} className="text-zinc-600" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter text…"
              className="bg-transparent border-none text-[10px] font-mono focus:ring-0 w-full placeholder:text-zinc-800 text-zinc-200"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-mono text-zinc-600 uppercase">Focus</span>
            {Object.values(FOCUS_AREAS).map((area) => (
              <button
                key={area.id}
                type="button"
                onClick={() => toggleFocus(area.id)}
                className={cn(
                  'px-2 py-1 text-[9px] font-mono uppercase border max-w-[120px] truncate',
                  selectedFocusAreas.includes(area.id)
                    ? 'bg-[#FF3E99]/80 text-black border-[#FF3E99]'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                )}
                title={area.label}
              >
                {area.id.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedFocusAreas([]);
              setActionableOnly(false);
              setDorkingOnly(false);
            }}
            className="p-1.5 text-zinc-600 hover:text-white"
            aria-label="Reset filters"
          >
            <Filter size={14} />
          </button>
        </div>
      </header>

      {err && <p className="text-red-400 text-sm font-mono mb-2">{err}</p>}

      <div className="max-w-[1800px] mx-auto space-y-6 relative z-10">
        <TopActions signals={killShotSignals} />

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5 xl:gap-6">
          <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#101014] to-[#08080a] p-4 shadow-lg shadow-black/40 space-y-4">
            <h2 className="text-[11px] font-mono uppercase text-emerald-400/90 flex items-center gap-2 tracking-widest">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(52,211,153,0.45)]" />
              Counts
            </h2>
            <p className="text-[9px] font-mono text-zinc-600 leading-relaxed -mt-2">
              Numbers for the current filter (except total + last row = full DB).
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard
                label="Total signals"
                value={loading ? '…' : String(stats?.total ?? 0)}
                trend="db"
                icon={<Activity size={18} />}
                className="border-emerald-900/40 bg-emerald-950/10"
              />
              <StatCard
                label="Filtered"
                value={String(filteredSignals.length)}
                trend="view"
                icon={<Target size={18} />}
                className="border-sky-900/40 bg-sky-950/10"
              />
              <StatCard
                label="Avg intensity"
                value={
                  filteredSignals.length
                    ? (
                        filteredSignals.reduce((a, s) => a + s.intensity, 0) /
                        filteredSignals.length
                      ).toFixed(1)
                    : '—'
                }
                trend="live"
                icon={<Zap size={18} />}
                className="border-amber-900/35 bg-amber-950/10"
              />
              <StatCard
                label="Last row time"
                value={stats?.lastSignalAt ? new Date(stats.lastSignalAt).toLocaleString() : '—'}
                icon={<Clock size={18} />}
                className="border-zinc-700/50 bg-zinc-900/30"
              />
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-gradient-to-br from-amber-950/25 to-zinc-950/80 p-3.5">
              <div className="flex items-center gap-2 text-amber-400/95 mb-2">
                <ShieldAlert size={14} />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wide">Sync</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                Data path: SQLite via <code className="text-amber-200/80 font-mono text-[10px]">DATABASE_PATH</code>{' '}
                (default <code className="text-zinc-500 font-mono text-[10px]">./data/pain.db</code>).
              </p>
              <p className="text-[10px] font-mono text-zinc-500 mt-2 border-t border-zinc-800/60 pt-2">
                Last row written:{' '}
                <span className="text-zinc-300">
                  {stats?.lastSignalAt ? new Date(stats.lastSignalAt).toISOString() : '—'}
                </span>
              </p>
            </div>
          </div>

          <div className="xl:col-span-2">
            <DashboardSnapshot stats={stats} loading={loading} />
          </div>

          <aside className="rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#0e0e12] to-[#060608] p-4 shadow-lg shadow-black/40 flex flex-col gap-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-indigo-400/90 border-b border-zinc-800/70 pb-2">
              Pipeline (db)
            </div>
            <div className="rounded-md bg-zinc-950/60 border border-zinc-800/60 p-2.5 space-y-1.5">
              <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">Status</p>
              {(stats?.byStatus ?? []).map((row) => (
                <div key={row.status} className="flex justify-between gap-2 text-[11px]">
                  <span className="text-zinc-400 truncate capitalize">{row.status}</span>
                  <span className="text-zinc-100 font-mono tabular-nums font-semibold">{row.count}</span>
                </div>
              ))}
              {!loading && stats && stats.byStatus.length === 0 && (
                <span className="text-zinc-600 text-[10px] font-mono">No rows yet — run ingest.</span>
              )}
            </div>
            <div className="rounded-md border border-rose-500/20 bg-rose-950/15 px-2.5 py-2 flex justify-between items-baseline gap-2">
              <span className="text-[9px] uppercase tracking-widest text-rose-300/80 font-mono">
                High value
                <br />
                <span className="text-[8px] text-rose-200/50 normal-case">intensity &gt; 85</span>
              </span>
              <span className="text-xl font-mono font-bold text-rose-100 tabular-nums" title="DB-wide">
                {loading ? '…' : String(stats?.highValueLeads ?? 0)}
              </span>
            </div>
            <div className="rounded-md bg-zinc-950/50 border border-zinc-800/60 p-2.5 space-y-1.5">
              <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">Sources (raw)</p>
              {(stats?.bySource ?? []).map((row) => (
                <div key={row.source} className="flex justify-between gap-2 text-[11px]">
                  <span className="text-zinc-500 truncate font-mono">{row.source}</span>
                  <span className="text-zinc-200 tabular-nums font-mono">{row.count}</span>
                </div>
              ))}
            </div>
            {stats?.byFocus?.[0] && (
              <div className="text-[10px] font-mono text-zinc-500 rounded-md bg-black/30 border border-zinc-800/50 px-2 py-1.5">
                Dominant bucket:{' '}
                <span className="text-fuchsia-300/90">
                  {Object.values(FOCUS_AREAS).find((a) => a.id === stats.byFocus[0].focusArea)?.label ??
                    stats.byFocus[0].focusArea}
                </span>{' '}
                <span className="text-zinc-400">({stats.byFocus[0].count})</span>
              </div>
            )}
            <details className="group rounded-md border border-zinc-800/70 bg-black/25 text-[9px] font-mono text-zinc-500 leading-relaxed">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-zinc-400 hover:text-zinc-300 flex items-center gap-1 [&::-webkit-details-marker]:hidden">
                <span className="text-zinc-600 group-open:hidden">▸</span>
                <span className="text-zinc-600 hidden group-open:inline">▾</span>
                Env / cron setup
              </summary>
              <div className="px-2 pb-2 pt-0 border-t border-zinc-800/50 space-y-1">
                <p>
                  Outreach: <code className="text-zinc-400">GEMINI_API_KEY</code>
                </p>
                <p>
                  Cron: <code className="text-zinc-400">CRON_SECRET</code> +{' '}
                  <code className="text-zinc-400">Authorization: Bearer …</code> on{' '}
                  <code className="text-zinc-400">/api/cron/ingest</code> or{' '}
                  <code className="text-zinc-400">/api/cron/ingest-dorks</code> (Docker DB).
                </p>
                <p>
                  Host scripts: <code className="text-zinc-400">npm run ingest</code>,{' '}
                  <code className="text-zinc-400">npm run ingest:dorks</code>
                </p>
              </div>
            </details>
          </aside>
        </div>

        <motion.div
          className="pt-4 border-t border-[#333]"
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 1 }}
        >
          <SignalFeed
            signals={filteredSignals}
            onRefetch={refetch}
            isRefreshing={loading}
            dorkingOnly={dorkingOnly}
            onDorkingOnlyChange={setDorkingOnly}
          />
        </motion.div>
      </div>

      <footer className="h-10 mt-6 flex items-center bg-[#111] border-t border-[#333] px-4 -mx-4 -mb-4 text-[10px] font-mono text-zinc-500">
        <span>Total in DB: {stats?.total ?? 0}</span>
        <span className="mx-4 w-px h-3 bg-zinc-800" />
        <span>Filtered: {filteredSignals.length}</span>
        <span className="ml-auto">better-sqlite3 + drizzle</span>
      </footer>
    </main>
  );
}
