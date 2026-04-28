import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { FeedSignal } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function downloadSignalsCsv(rows: FeedSignal[]) {
  const header = [
    'id',
    'source',
    'sourceUrl',
    'title',
    'text',
    'focusArea',
    'intensity',
    'status',
    'painSummary',
    'opportunityAngle',
    'confidenceScore',
    'actionType',
    'createdAt',
  ]
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.source,
        r.sourceUrl,
        r.title ?? '',
        r.text,
        r.focusArea ?? '',
        String(r.intensity),
        r.status,
        r.painSummary ?? '',
        r.opportunityAngle ?? '',
        r.confidenceScore != null ? String(r.confidenceScore) : '',
        r.actionType ?? '',
        r.timestamp,
      ]
        .map(esc)
        .join(',')
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `pain-signals-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
