import { useEffect, useState, type KeyboardEvent } from 'react'
import type { SuggestResult } from '../lib/api'
import { useAutocomplete } from '../lib/useAutocomplete'
import { useSentence } from '../lib/useSentence'
import type { SearchStatus } from '../lib/useSearch'
import { SearchBar } from './SearchBar'
import { ResultsList } from './ResultsList'
import { SentenceView } from './SentenceView'

interface SearchProps {
  query: string
  /** the query the results were fetched for */
  debouncedQuery: string
  results: SuggestResult[]
  status: SearchStatus
  error: string | null
  loading: boolean
  resolvedQuery: string
  reflexFallback: boolean
  onQueryChange: (value: string) => void
  onSelect: (id: number) => void
}

/**
 * The suggestions help while you type. When you stop (to read the results under them) they get
 * out of the way after this long; typing again brings them back.
 */
const SUGGESTIONS_IDLE_MS = 1500

export function Search({
  query,
  debouncedQuery,
  results,
  status,
  error,
  loading,
  resolvedQuery,
  reflexFallback,
  onQueryChange,
  onSelect,
}: SearchProps) {
  const hasQuery = query.trim() !== ''

  // --- sentence mode ---------------------------------------------------- //
  // A query of several words that reads as German text (most words resolve to entries) and is
  // not itself a phrase of the dictionary is shown cut into words, with the card of each word.
  // Anything else (a German phrase, an English search like "hot water") stays a normal search.
  const sentence = useSentence(debouncedQuery.trim())
  const germanPhrase = results.some((r) => r.kind <= 2)
  const resolved = sentence
    ? sentence.tokens.filter((t) => t.word && (t.candidates?.length || t.compound)).length
    : 0
  const sentenceMode =
    sentence !== null &&
    !loading &&
    !germanPhrase &&
    sentence.stats.words >= 2 &&
    resolved / sentence.stats.words >= 0.6
  const [selectedIndex, setSelectedIndex] = useState(-1)

  // --- autocomplete ----------------------------------------------------- //
  const suggestions = useAutocomplete(query)
  const [focused, setFocused] = useState(true)
  // The query for which the dropdown was dismissed (pick / Esc / Enter / a pause); typing
  // anything else re-opens it. A search that is already in the page (a link, a reload) starts
  // dismissed: the results are what you came for.
  const [dismissedFor, setDismissedFor] = useState<string | null>(query)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)

  const dropdownOpen =
    focused && hasQuery && suggestions.length > 0 && dismissedFor !== query

  useEffect(() => {
    if (!dropdownOpen) return
    const timer = window.setTimeout(() => setDismissedFor(query), SUGGESTIONS_IDLE_MS)
    return () => window.clearTimeout(timer)
    // restart the countdown whenever the user types or moves through the suggestions
  }, [dropdownOpen, query, suggestions, activeSuggestion])

  // Reset the keyboard highlight whenever the query or results change.
  useEffect(() => {
    setSelectedIndex(-1)
  }, [query, results])

  useEffect(() => {
    setActiveSuggestion(-1)
  }, [query, suggestions])

  const pickSuggestion = (word: string) => {
    setDismissedFor(word)
    onQueryChange(word)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The open dropdown owns the arrow keys / Enter / Escape.
    if (dropdownOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSuggestion((i) => Math.max(i - 1, -1))
        return
      }
      if (event.key === 'Enter' && activeSuggestion >= 0) {
        event.preventDefault()
        pickSuggestion(suggestions[activeSuggestion]!.word)
        return
      }
      if (event.key === 'Enter') {
        // searching: the results are what matters now, not the suggestions
        setDismissedFor(query)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedFor(query)
        return
      }
    }

    if (event.key === 'ArrowDown') {
      if (results.length === 0) return
      event.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      if (results.length === 0) return
      event.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, -1))
    } else if (event.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        event.preventDefault()
        onSelect(results[selectedIndex].id)
      }
    }
  }

  return (
    <section>
      <SearchBar
        value={query}
        loading={loading}
        onChange={onQueryChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        suggestions={suggestions}
        open={dropdownOpen}
        activeIndex={activeSuggestion}
        onPick={pickSuggestion}
      />
      {sentenceMode && sentence ? (
        <SentenceView
          key={debouncedQuery.trim()}
          analysis={sentence}
          onOpenEntry={onSelect}
          onSelectTerm={onQueryChange}
        />
      ) : (
        <>
      {status === 'ready' && reflexFallback && results.length > 0 && (
        <p className="mt-3 px-1 text-sm text-slate-400">
          Showing results for{' '}
          <span className="font-semibold text-violet-300">“{resolvedQuery}”</span>
        </p>
      )}
      {status === 'ready' && results.length > 0 && (
        <p className="mt-3 px-1 text-xs font-medium uppercase tracking-widest text-slate-500">
          {results.length} {results.length === 1 ? 'result' : 'results'}
        </p>
      )}
      <ResultsList
        results={results}
        loading={status === 'loading'}
        hasQuery={hasQuery}
        error={error}
        onSelect={onSelect}
        selectedIndex={selectedIndex}
      />
        </>
      )}
    </section>
  )
}
