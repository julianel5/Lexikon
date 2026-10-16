import { useEffect, useRef } from 'react'
import type { SuggestResult } from '../lib/api'
import { ArticleChips } from './ArticleChips'

/** `kind` the API reports for a reverse (English -> German) match. */
const ENGLISH_MATCH_KIND = 3

interface ResultCardProps {
  result: SuggestResult
  onSelect: (id: number) => void
  isKeyboardSelected?: boolean
}

export function ResultCard({
  result,
  onSelect,
  isKeyboardSelected = false,
}: ResultCardProps) {
  const ref = useRef<HTMLLIElement>(null)
  // kind 3: the German word was found through its English translation
  const viaEnglish = result.kind === ENGLISH_MATCH_KIND

  // Keep the keyboard-highlighted result visible within the viewport.
  useEffect(() => {
    if (isKeyboardSelected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [isKeyboardSelected])

  return (
    <li ref={ref} className="list-none">
      <button
        type="button"
        onClick={() => onSelect(result.id)}
        aria-label={`Open full entry for ${result.word}`}
        aria-current={isKeyboardSelected ? 'true' : undefined}
        className={`group relative flex w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300 hover:border-slate-700/60 hover:bg-slate-800/40 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
          isKeyboardSelected
            ? 'border-slate-700/60 bg-slate-800/40'
            : viaEnglish
              ? 'border-slate-700/50 bg-slate-900/40'
              : 'border-slate-800/40 bg-slate-900/40'
        }`}
      >
        {/* left accent */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 origin-center bg-violet-500 transition-transform duration-300 group-hover:scale-y-100 ${
            isKeyboardSelected ? 'scale-y-100' : 'scale-y-0'
          }`}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={`text-lg font-bold transition-colors group-hover:text-violet-400 ${
              isKeyboardSelected ? 'text-violet-400' : 'text-slate-100'
            }`}
          >
            {result.word}
          </span>
          <ArticleChips article={result.article} />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {result.pos}
          </span>
          {viaEnglish && (
            <span
              title="Found through its English translation"
              aria-label="Matched an English translation"
              className="rounded border border-slate-700 px-1.5 py-px text-[10px] font-bold uppercase tracking-widest text-slate-500"
            >
              ENG
            </span>
          )}
          {result.plural && (
            <span className="text-xs text-slate-500">pl. {result.plural}</span>
          )}
        </div>

        {result.snippet && (
          <p className="text-sm leading-relaxed text-slate-400">
            {result.snippet}
          </p>
        )}
      </button>
    </li>
  )
}
