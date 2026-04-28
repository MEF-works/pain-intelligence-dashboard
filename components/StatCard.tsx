'use client';

import * as React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  trend?: string;
  trendDirection?: 'up' | 'down';
  icon: React.ReactNode;
}

export function StatCard({ label, value, trend, trendDirection, icon }: StatCardProps) {
  return (
    <div className="bg-[#0F0F0F] p-3 rounded border border-zinc-800 flex flex-col gap-1 relative overflow-hidden group">
      <div className="flex justify-between items-start relative z-10">
        <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest leading-none">
          {label}
        </span>
        <div className="text-zinc-600 group-hover:text-[#FF3E3E] transition-colors">
          {React.cloneElement(icon as React.ReactElement<{ size: number }>, { size: 14 })}
        </div>
      </div>
      
      <div className="flex items-baseline gap-2 relative z-10">
        <span className="text-xl font-mono font-bold tracking-tighter text-white">
          {value}
        </span>
        {trend &&
          (trendDirection ? (
            <span
              className={cn(
                'text-[8px] font-mono',
                trendDirection === 'up' ? 'text-[#FF3E3E]' : 'text-green-500'
              )}
            >
              {trendDirection === 'up' ? '▲' : '▼'}
              {trend}
            </span>
          ) : (
            <span className="text-[8px] font-mono text-zinc-600">{trend}</span>
          ))}
      </div>

      <div className="absolute top-0 right-0 w-8 h-8 opacity-[0.03] text-white">
        {React.cloneElement(icon as React.ReactElement<{ size: number }>, { size: 32 })}
      </div>
    </div>
  );
}
