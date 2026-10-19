import { useCallback, useEffect, useRef, useState } from 'react'
import { EntryView } from './components/EntryView'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { Search } from './components/Search'
import { fetchSuggest, type Entry } from './lib/api'
import { buildPath, parseLocation } from './lib/route'
import { useSearch } from './lib/useSearch'

const BASE_TITLE = 'Lexikon'

export default function App() {
  const initial = useRef(parseLocation(window.location)).current
  const search = useSearch(175, initial.q)
  const [selectedId, setSelectedId] = useState<number | null>(initial.entryId)
  // The word from the URL (/entry/<id>/<word>); used to detect stale ids.
  const slugRef = useRef<string | null>(initial.slug)

  const { setQuery } = search

  // --- URL <-> state ---------------------------------------------------- //

  const showEntry = useCallback((id: number) => {
    slugRef.current = null
    setSelectedId(id)
    window.history.pushState(null, '', buildPath({ entryId: id }))
  }, [])

  const showSearch = useCallback(
    (q: string) => {
      slugRef.current = null
      setSelectedId(null)
      setQuery(q)
      document.title = BASE_TITLE
      window.history.pushState(null, '', buildPath({ q }))
    },
    [setQuery],
  )

  // Browser back/forward.
  useEffect(() => {
    const onPopState = () => {
      const route = parseLocation(window.location)
      slugRef.current = route.slug
      setSelectedId(route.entryId)
      if (route.entryId === null) {
        setQuery(route.q)
        document.title = BASE_TITLE
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [setQuery])

  // Keep ?q= in the address bar while searching (replace, don't pile up).
  useEffect(() => {
    if (selectedId !== null) return
    const path = buildPath({ q: search.debouncedQuery })
    if (path !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', path)
    }
  }, [selectedId, search.debouncedQuery])

  // Resolve a stale/removed id by the word stored in the URL.
  const resolveBySlug = useCallback(
    (slug: string) => {
      fetchSuggest(slug, new AbortController().signal)
        .then((data) => {
          const hit = data.results.find((r) => r.word === slug)
          if (hit) {
            slugRef.current = null
            setSelectedId(hit.id)
            window.history.replaceState(
              null,
              '',
              buildPath({ entryId: hit.id, slug: hit.word }),
            )
          } else {
            slugRef.current = null
            setSelectedId(null)
            setQuery(slug)
          }
        })
        .catch(() => {
          /* leave the error state from the entry view in place */
        })
    },
    [setQuery],
  )

  const handleLoaded = useCallback(
    (entry: Entry) => {
      const slug = slugRef.current
      if (slug && entry.word !== slug) {
        resolveBySlug(slug)
        return
      }
      slugRef.current = null
      document.title = `${entry.word} · ${BASE_TITLE}`
      window.history.replaceState(
        null,
        '',
        buildPath({ entryId: entry.id, slug: entry.word }),
      )
    },
    [resolveBySlug],
  )

  const handleMissing = useCallback(() => {
    const slug = slugRef.current
    if (slug) resolveBySlug(slug)
  }, [resolveBySlug])

  // The magnifier in the header: back to the search page (keeping the query) and focus the box.
  const goToSearch = () => {
    if (selectedId !== null) showSearch(search.query)
    window.requestAnimationFrame(() =>
      document.getElementById('search-input')?.focus(),
    )
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-canvas-from font-sans text-slate-100 antialiased selection:bg-violet-500/30 selection:text-violet-200">

      <Header onHome={() => showSearch('')} onSearch={goToSearch} />

      <main className="relative mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:py-14">

        {selectedId === null ? (
          <Search
            query={search.query}
            debouncedQuery={search.debouncedQuery}
            results={search.results}
            status={search.status}
            error={search.error}
            loading={search.loading}
            resolvedQuery={search.resolvedQuery}
            reflexFallback={search.reflexFallback}
            onQueryChange={search.setQuery}
            onSelect={showEntry}
          />
        ) : (
          <EntryView
            id={selectedId}
            onSelectTerm={showSearch}
            onOpenEntry={showEntry}
            onLoaded={handleLoaded}
            onMissing={handleMissing}
          />
        )}
      </main>

      <Footer />
    </div>
  )
}
