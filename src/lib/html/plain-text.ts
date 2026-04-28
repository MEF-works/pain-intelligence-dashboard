/**
 * Turn RSS / HTML-ish snippets into readable plain text (no new dependencies).
 */

/** Decode numeric and common named HTML entities; repeats until stable for &amp;… chains. */
export function decodeHtmlEntities(input: string): string {
  let s = input;
  for (let i = 0; i < 12; i++) {
    const prev = s;
    s = s.replace(/&#x([0-9a-fA-F]{1,8});/gi, (full, hex: string) => {
      const cp = parseInt(hex, 16);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return full;
      }
    });
    s = s.replace(/&#(\d{1,8});/g, (full, dec: string) => {
      const cp = parseInt(dec, 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return full;
      }
    });
    s = s.replace(
      /&(nbsp|laquo|raquo|ndash|mdash|bull|lt|gt|quot|apos|amp);/gi,
      (_, name: string) => {
        const map: Record<string, string> = {
          nbsp: ' ',
          laquo: '\u00AB',
          raquo: '\u00BB',
          ndash: '\u2013',
          mdash: '\u2014',
          bull: '\u2022',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          amp: '&',
        };
        return map[name.toLowerCase()] ?? `&${name};`;
      }
    );
    if (s === prev) break;
  }
  return s;
}

/** Strip tags / CDATA wrappers and collapse whitespace. */
export function stripHtmlToText(input: string): string {
  return input
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Full pipeline: entities like &lt;h2&gt; → decode → strip tags → normalize. */
export function plainTextFromHtmlish(raw: string): string {
  if (!raw) return '';
  let s = decodeHtmlEntities(raw);
  s = stripHtmlToText(s);
  s = decodeHtmlEntities(s);
  s = stripHtmlToText(s);
  return s;
}
