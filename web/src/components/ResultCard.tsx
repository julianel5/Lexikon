import { useEffect, useRef } from 'react'
import type { SuggestResult } from '../lib/api'
import { ArticleChips } from './ArticleChips'
import { PILL, PosPill } from './Pills'

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
        // same card as the entry page: card colours, thin border, 6px radius, 16px padding
        className={`group relative flex w-full cursor-pointer flex-col gap-2 overflow-hidden rounded-card border bg-card p-4 text-left transition-colors hover:border-card-edge-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
          isKeyboardSelected ? 'border-card-edge-strong' : 'border-card-edge'
        }`}
      >
        {/* left accent */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 origin-center bg-violet-500 transition-transform duration-300 group-hover:scale-y-100 ${
            isKeyboardSelected ? 'scale-y-100' : 'scale-y-0'
          }`}
        />

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={`text-lg font-semibold transition-colors group-hover:text-violet-400 ${
              isKeyboardSelected ? 'text-violet-400' : 'text-slate-100'
            }`}
          >
            {result.word}
          </span>
          <ArticleChips article={result.article} />
          <PosPill pos={result.pos} />
          {viaEnglish && (
            <span
              title="Found through its English translation"
              aria-label="Matched an English translation"
              className={`${PILL} bg-slate-700/40 text-slate-200`}
            >
              ENG
            </span>
          )}
          {result.plural && (
            <span className="text-xs text-slate-400">pl. {result.plural}</span>
          )}
        </div>

        {result.snippet && (
          <p className="text-sm leading-relaxed text-slate-300">
            {result.snippet}
          </p>
        )}
      </button>
    </li>
  )
}
