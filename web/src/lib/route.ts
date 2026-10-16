/**
 * Tiny URL <-> view mapping (no router dependency).
 *
 *   /                      search home
 *   /?q=ging               search for "ging"
 *   /entry/3004            entry page by id
 *   /entry/3004/Haus       entry page; the word is a safety net: if the id
 *                          now points at a different word (the DB was
 *                          regenerated) the app re-resolves it by word.
 */

export interface Route {
  entryId: number | null
  slug: string | null
  q: string
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseLocation(
  loc: Pick<Location, 'pathname' | 'search'>,
): Route {
  const q = new URLSearchParams(loc.search).get('q') ?? ''
  const match = /^\/entry\/(\d+)(?:\/([^/]+))?\/?$/.exec(loc.pathname)
  if (!match) return { entryId: null, slug: null, q }
  return {
    entryId: Number(match[1]),
    slug: match[2] ? safeDecode(match[2]) : null,
    q,
  }
}

export function buildPath(route: {
  entryId?: number | null
  slug?: string | null
  q?: string
}): string {
  if (route.entryId != null) {
    const slug = route.slug ? `/${encodeURIComponent(route.slug)}` : ''
    return `/entry/${route.entryId}${slug}`
  }
  const q = route.q?.trim()
  return q ? `/?q=${encodeURIComponent(q)}` : '/'
}
