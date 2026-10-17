/**
 * Sitemap XML for search engines (https://www.sitemaps.org/protocol.html).
 *
 * The site is a single-page app: an entry page such as /entry/34/Haus is only
 * rendered from the API's data, so the URLs have to be listed from the
 * database, which only the API has. robots.txt therefore points at this API,
 * and the origin is fixed here: a sitemap must always name the canonical URLs
 * of the live site, wherever the API happens to run.
 */

/** Canonical site origin: entry URLs always point here, wherever the API runs. */
export const SITE_ORIGIN = "https://lexikon.moe";
/** Origin of this API, as named in robots.txt and in the sitemap index. */
export const API_ORIGIN = "https://api.lexikon.moe";
/** A sitemap file holds at most 50,000 URLs (and 50 MB uncompressed). */
export const SITEMAP_PAGE_SIZE = 50_000;

export interface SitemapEntry {
  id: number;
  word: string;
}

/**
 * How many page files an `entryCount`-entry dictionary needs. Never 0: an
 * empty page is still a valid file, and it keeps the index well-formed.
 */
export function sitemapPageCount(entryCount: number): number {
  return Math.max(1, Math.ceil(entryCount / SITEMAP_PAGE_SIZE));
}

/** XML escaping, so a URL can never close the element it sits in. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The entry's URL, built exactly like the web app builds it
 * (web/src/lib/route.ts, buildPath): the id keeps it stable, the word is a
 * readable safety net, and encodeURIComponent keeps it a valid path segment.
 */
export function entryUrl(entry: SitemapEntry): string {
  return `${SITE_ORIGIN}/entry/${entry.id}/${encodeURIComponent(entry.word)}`;
}

/** One `<urlset>` document: the declaration, then one URL per line. */
export function buildSitemapPage(entries: readonly SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => `<url><loc>${escapeXml(entryUrl(entry))}</loc></url>`),
    "</urlset>",
  ].join("\n");
}

/** A `<sitemapindex>` listing every page file, so crawlers fetch them in order. */
export function buildSitemapIndex(pageCount: number): string {
  const sitemaps = Array.from({ length: pageCount }, (_none, page) =>
    `<sitemap><loc>${API_ORIGIN}/api/sitemap/page/${page}</loc></sitemap>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemaps,
    "</sitemapindex>",
  ].join("\n");
}
