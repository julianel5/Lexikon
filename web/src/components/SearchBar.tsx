import type { KeyboardEvent } from 'react'
import type { AutocompleteItem } from '../lib/api'

interface SearchBarProps {
  value: string
  loading: boolean
  onChange: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Autocomplete dropdown. */
  suggestions?: AutocompleteItem[]
  open?: boolean
  activeIndex?: number
  onPick?: (word: string) => void
}

const LISTBOX_ID = 'search-suggestions'

/** Bold the part of the suggestion that was not typed yet. */
function Suggestion({ word, typed }: { word: string; typed: string }) {
  const n = typed.length
  const matches = n > 0 && word.toLowerCase().startsWith(typed.toLowerCase())
  if (!matches) return <span className="font-semibold">{word}</span>
  return (
    <span>
      {word.slice(0, n)}
      <span className="font-semibold">{word.slice(n)}</span>
    </span>
  )
}

export function SearchBar({
  value,
  loading,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  suggestions = [],
  open = false,
  activeIndex = -1,
  onPick,
}: SearchBarProps) {
  const typed = value.trim().replace(/^sich\s+/i, '')

  return (
    <div className="relative">
      <div className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 transition-all duration-300 focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/10">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 shrink-0 text-slate-500"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>

        <input
          id="search-input"
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${LISTBOX_ID}-${activeIndex}` : undefined
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Search a German word…"
          aria-label="Search a German word"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full bg-transparent text-lg font-medium tracking-tight text-white outline-none placeholder:text-slate-500"
        />

        {loading && (
          <svg
            className="h-5 w-5 shrink-0 animate-spin text-violet-400"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 py-1"
        >
          {suggestions.map((item, index) => (
            <li
              key={item.id}
              id={`${LISTBOX_ID}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown (not click) so the input keeps focus and the
              // dropdown does not close before the pick registers.
              onMouseDown={(e) => {
                e.preventDefault()
                onPick?.(item.word)
              }}
              className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-base text-slate-200 ${
                index === activeIndex
                  ? 'bg-slate-800 text-violet-400'
                  : 'hover:bg-slate-800/60'
              }`}
            >
              <Suggestion word={item.word} typed={typed} />
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {item.pos}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
