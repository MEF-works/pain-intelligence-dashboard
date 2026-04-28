import type { FocusAreaId } from './focus-areas';

export type DorkQuery = {
  id: string;
  /** Short label for logs / UI context */
  label: string;
  /** Passed to Serper as Google `q` (dork-style queries) */
  query: string;
  focusAreaId: FocusAreaId;
};

/**
 * High-intent WordPress / WooCommerce failure signals visible in Google results.
 * Tune queries sparingly — overly broad strings add noise and burn API credits.
 */
export const GOOGLE_DORK_QUERIES: readonly DorkQuery[] = [
  {
    id: 'critical_error',
    label: 'Critical Error',
    query: '"There has been a critical error on this website"',
    focusAreaId: 'blast_radius',
  },
  {
    id: 'database_connection_error',
    label: 'Database Connection Error',
    query: '"Error establishing a database connection"',
    focusAreaId: 'blast_radius',
  },
  {
    id: 'woocommerce_error',
    label: 'WooCommerce Error',
    query: '("woocommerce" OR "WooCommerce") ("critical error" OR "database error" OR "payment gateway")',
    focusAreaId: 'blast_radius',
  },
] as const;
