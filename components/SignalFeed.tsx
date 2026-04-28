'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FeedSignal } from '@/lib/types';
import { FOCUS_AREAS } from '@/lib/constants/focus-areas';
import { Copy, Check, X, ExternalLink, Zap, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUSES = ['new', 'outreached', 'paid', 'dead'] as const;

function intensityBadgeClass(intensity: number): string {
  if (intensity > 80) return 'border-red-500/50 bg-red-500/15 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.25)]';
  if (intensity > 60) return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
  return 'border-zinc-700 bg-zinc-900/80 text-zinc-400';
}

function keywordsForFocus(focusAreaId: string | null): string[] {
  if (!focusAreaId) return [];
  const area = Object.values(FOCUS_AREAS).find((a) => a.id === focusAreaId);
  return area ? [...area.keywords] : [];
}

interface SignalFeedProps {
  signals: FeedSignal[];
  onRefetch: () => void;
  /** Parent is re-fetching signals/stats from the API */
  isRefreshing?: boolean;
}

export function SignalFeed({ signals, onRefetch, isRefreshing }: SignalFeedProps) {
  const [outreachFor, setOutreachFor] = React.useState<string | null>(null);
  const [outreachText, setOutreachText] = React.useState('');
  const [outreachLoading, setOutreachLoading] = React.useState(false);
  const [outreachErr, setOutreachErr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [statusLoading, setStatusLoading] = React.useState<string | null>(null);

  const patchStatus = async (id: string, status: (typeof STATUSES)[number]) => {
    setStatusLoading(id + status);
    try {
      const res = await fetch(`/api/signals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefetch();
    } finally {
      setStatusLoading(null);
    }
  };

  const generateOutreach = async (id: string) => {
    setOutreachFor(id);
    setOutreachText('');
    setOutreachErr(null);
    setOutreachLoading(true);
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { text?: string };
      setOutreachText(data.text ?? '');
    } catch (e) {
      setOutreachErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setOutreachLoading(false);
    }
  };

  const copyOutreach = () => {
    if (!outreachText) return;
    void navigator.clipboard.writeText(outreachText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="glass-panel rounded-lg overflow-hidden flex flex-col min-h-[480px] max-h-[min(80vh,900px)]">
        <div className="p-3 border-b border-zinc-800 flex justify-between items-center bg-transparent">
          <h2 className="text-[11px] font-mono uppercase text-zinc-300 tracking-widest leading-none">
            Live signals (pain_signals)
          </h2>
          <div className="flex items-center gap-2">
            {isRefreshing ? (
              <span className="text-[9px] font-mono text-zinc-500 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                Syncing…
              </span>
            ) : (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                <span className="text-[9px] font-mono text-green-500 font-bold tracking-tighter">DB</span>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {signals.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center p-8 text-center"
              >
                <div className="text-[#FF3E3E] mb-2 opacity-20">
                  <Zap size={48} />
                </div>
                <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                  No rows — run npm run ingest
                </p>
              </motion.div>
            ) : (
              signals.map((signal, index) => {
                const kws = keywordsForFocus(signal.focusArea);
                return (
                  <motion.div
                    key={signal.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ delay: index * 0.02 }}
                    className="p-3 rounded bg-black border border-zinc-900 hover:border-zinc-800 transition-colors"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'text-lg font-mono font-bold tabular-nums px-2 py-0.5 rounded border shrink-0',
                            intensityBadgeClass(signal.intensity)
                          )}
                          title="Semantic intensity score"
                        >
                          {signal.intensity}
                        </span>
                        <span
                          className={cn(
                            'text-[8px] font-mono px-1.5 py-0.5 rounded border font-bold uppercase shrink-0',
                            signal.source === 'reddit'
                              ? 'text-orange-500 border-orange-500/20 bg-orange-500/5'
                              : signal.source === 'job_rss'
                                ? 'text-cyan-500 border-cyan-500/20 bg-cyan-500/5'
                                : 'text-zinc-500 border-zinc-500/20'
                          )}
                        >
                          {signal.source.replace('_', ' ')}
                        </span>
                        <span className="text-[8px] font-mono text-zinc-600">
                          {new Date(signal.timestamp).toLocaleString()}
                        </span>
                        <span className="text-[8px] font-mono text-zinc-500" title="Last scrutinize check">
                          Verified:{' '}
                          {signal.lastVerifiedAt
                            ? new Date(signal.lastVerifiedAt).toLocaleString()
                            : '—'}
                        </span>
                        {signal.focusArea && (
                          <span className="text-[7px] font-mono px-1 py-0.5 rounded border border-[#FF3E3E]/30 text-[#FF3E99] uppercase truncate max-w-[160px]">
                            {signal.focusArea.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="text-[7px] font-mono text-zinc-500 uppercase">
                          {signal.status}
                        </span>
                      </div>
                      {signal.intensity > 85 && (
                        <Zap size={10} className="text-[#FF3E3E] fill-[#FF3E3E] shrink-0" />
                      )}
                    </div>

                    <p className="text-[11px] leading-snug text-zinc-300 font-sans mb-3 line-clamp-6">
                      {signal.text.split(/\s+/).map((word, i) => {
                        const hit = kws.some((kw) => word.toLowerCase().includes(kw.toLowerCase()));
                        return hit ? (
                          <span key={i} className="text-white font-bold">
                            {word}{' '}
                          </span>
                        ) : (
                          <span key={i} className="opacity-80">
                            {word}{' '}
                          </span>
                        );
                      })}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex flex-wrap gap-1">
                        {STATUSES.map((st) => (
                          <button
                            key={st}
                            type="button"
                            disabled={statusLoading !== null}
                            onClick={() => void patchStatus(signal.id, st)}
                            className={cn(
                              'px-1.5 py-0.5 text-[7px] font-mono uppercase border rounded',
                              signal.status === st
                                ? 'bg-white text-black border-white'
                                : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-600'
                            )}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void generateOutreach(signal.id)}
                          className="px-2 py-1 text-[8px] font-mono uppercase bg-[#FF3E3E]/20 text-[#FF3E3E] border border-[#FF3E3E]/40 rounded hover:bg-[#FF3E3E]/30"
                        >
                          Generate outreach
                        </button>
                        <a
                          href={signal.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[8px] font-mono text-zinc-400 hover:text-white"
                        >
                          Source
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>

        <div className="p-2 bg-zinc-900/30 border-t border-zinc-800 flex justify-between text-[9px] font-mono text-zinc-600">
          <span>ROWS: {signals.length}</span>
          <span>sqlite</span>
        </div>
      </div>

      {outreachFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" role="dialog">
          <div className="w-full max-w-lg border border-zinc-700 bg-[#0a0a0a] rounded-lg p-4 shadow-xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-mono uppercase text-zinc-300">Outreach bridge</h3>
              <button
                type="button"
                onClick={() => setOutreachFor(null)}
                className="p-1 text-zinc-500 hover:text-white"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {outreachLoading && (
              <div className="flex items-center gap-2 text-zinc-500 text-sm py-8">
                <Loader2 className="animate-spin" size={16} />
                Generating…
              </div>
            )}
            {outreachErr && <p className="text-sm text-red-400 mb-2">{outreachErr}</p>}
            {!outreachLoading && outreachText && (
              <p className="text-sm text-zinc-200 leading-relaxed mb-4 whitespace-pre-wrap">{outreachText}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyOutreach}
                disabled={!outreachText}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-zinc-800 border border-zinc-600 rounded hover:bg-zinc-700 disabled:opacity-40"
              >
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setOutreachFor(null)}
                className="px-3 py-1.5 text-xs font-mono text-zinc-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
