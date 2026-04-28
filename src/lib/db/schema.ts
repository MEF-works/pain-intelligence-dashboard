import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const painSignals = sqliteTable(
  'pain_signals',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull(),
    title: text('title'),
    content: text('content').notNull(),

    /** SHA-256 of normalized text for deduplication. */
    contentHash: text('content_hash'),
    focusArea: text('focus_area'),
    intensity: integer('intensity').default(0),

    /** new | outreached | paid | dead */
    status: text('status').notNull().default('new'),
    rawBudget: text('raw_budget'),

    /** Append-only log lines from scrutinize / verification runs */
    auditLog: text('audit_log'),

    /** Last time scrutinize verified sourceUrl (proof-of-life) */
    lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    lastUpdated: integer('last_updated', { mode: 'timestamp' }),
  },
  (t) => [uniqueIndex('pain_signals_content_hash_uq').on(t.contentHash)]
);

export type PainSignalRow = typeof painSignals.$inferSelect;
export type NewPainSignalRow = typeof painSignals.$inferInsert;
