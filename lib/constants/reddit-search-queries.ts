/**
 * Reddit global search queries (public search.json) — first-person + pain language.
 * Override with env `REDDIT_SEARCH_QUERIES` (split segments by `||||`).
 */
export const REDDIT_SEARCH_QUERIES = [
  '"my site" not working',
  '"my store" checkout broken',
  '"my website" error',
  '"lost sales" woocommerce',
  '"checkout not working" stripe',
  '"stripe" not charging',
  '"woocommerce" broken checkout',
  '"shopify" checkout issue',
  '"customers cannot" checkout',
  '"my wordpress" fatal error',
] as const;
