import { useState } from 'react'
import type { TextAnalysis, TextToken } from '../lib/api'
import { EntryPreview } from './EntryView'
import { PosPill } from './Pills'

interface SentenceViewProps {
  analysis: TextAnalysis
  onOpenEntry: (id: number) => void
  onSelectTerm: (term: string) => void
}

/** The entries a word of the sentence can be (its candidates, or the parts of a compound). */
function optionsOf(token: TextToken): { id: number; word: string; pos: string; note?: string }[] {
  if (token.candidates?.length) {
    return token.candidates.map((c) => ({
      id: c.id,
      word: c.word,
      pos: c.pos,
      note: c.viaForm ? `form of ${c.word}` : undefined,
    }))
  }
  return (token.compound ?? []).map((p) => ({ id: p.id, word: p.word, pos: p.pos }))
}

function wordClass(token: TextToken, selected: boolean): string {
  const base =
    'cursor-pointer rounded-sm px-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'
  const look = token.candidates?.length
    ? 'border-b border-violet-400/70 hover:bg-violet-900/30'
    : token.compound
      ? 'border-b border-dashed border-amber-400/70 hover:bg-amber-900/30'
      : 'text-slate-500 hover:bg-slate-800/60'
  return `${base} ${look} ${selected ? 'bg-violet-900/40' : ''}`
}

/**
 * A sentence typed in the search box, cut into words (known ones underlined) with the card of the
 * selected word right below, like Jiten's text parsing. Mount it with `key={query}`: the
 * selection restarts for every new sentence.
 */
export function SentenceView({ analysis, onOpenEntry, onSelectTerm }: SentenceViewProps) {
  const { tokens, stats } = analysis
  const firstKnown = tokens.findIndex((t) => t.word && optionsOf(t).length > 0)
  const [selected, setSelected] = useState<number | null>(firstKnown >= 0 ? firstKnown : null)
  const [choice, setChoice] = useState(0)

  const token = selected !== null ? tokens[selected] : undefined
  const options = token ? optionsOf(token) : []
  const current = options[Math.min(choice, options.length - 1)]

  const select = (index: number) => {
    setSelected(index)
    setChoice(0)
  }

  return (
    <div className="mt-4">
      <p className="rounded-card border border-card-edge-strong bg-card px-4 py-3 text-sm text-slate-300">
        {stats.unique} different {stats.unique === 1 ? 'word' : 'words'} in this text
        {stats.unknown > 0 && (
          <span className="text-slate-500"> · {stats.unknown} not found</span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3">
        <p className="whitespace-pre-wrap text-xl leading-[2.2] text-slate-100 [overflow-wrap:anywhere]">
          {tokens.map((t, i) =>
            t.word ? (
              <button
                key={i}
                type="button"
                onClick={() => select(i)}
                aria-pressed={selected === i}
                className={wordClass(t, selected === i)}
              >
                {t.text}
              </button>
            ) : (
              <span key={i}>{t.text}</span>
            ),
          )}
        </p>
        {selected !== null && (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="min-h-8 cursor-pointer rounded-card border border-card-edge-strong px-2 text-xs text-slate-400 transition-colors hover:text-violet-400"
          >
            Clear selection
          </button>
        )}
      </div>

      {token && (
        <div className="mt-4">
          {options.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Possible entries">
              {options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={i === choice}
                  onClick={() => setChoice(i)}
                  className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-card border px-3 text-sm transition-colors ${
                    i === choice
                      ? 'border-violet-500/60 bg-violet-900/30 text-violet-200'
                      : 'border-card-edge-strong bg-card text-slate-300 hover:border-violet-500/40'
                  }`}
                >
                  {o.word}
                  <PosPill pos={o.pos} />
                </button>
              ))}
            </div>
          )}

          {!token.candidates?.length && token.compound && (
            <p className="mb-3 text-sm text-amber-300">
              Compound word: {token.compound.map((p) => p.word).join(' + ')}
            </p>
          )}
          {current?.note && (
            <p className="mb-3 text-sm text-slate-400">
              “{token.text}” is a {current.note}
            </p>
          )}

          {current ? (
            <>
              <EntryPreview id={current.id} onSelectTerm={onSelectTerm} />
              <button
                type="button"
                onClick={() => onOpenEntry(current.id)}
                className="mt-2 min-h-10 cursor-pointer text-sm text-slate-400 underline transition-colors hover:text-violet-400"
              >
                Open the entry page
              </button>
            </>
          ) : (
            <p className="rounded-card border border-card-edge bg-card p-4 text-sm text-slate-400">
              No dictionary entry found for “{token.text}”.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
