import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  MAX_TEXT_LENGTH,
  type TextAnalysis,
  type TextCandidate,
  type TextPart,
  type TextToken,
} from '../lib/api'
import type { TextStatus } from '../lib/useTextAnalysis'
import { ArticleChips } from './ArticleChips'
import { PosPill } from './Pills'

interface TextViewProps {
  text: string
  onTextChange: (value: string) => void
  analysis: TextAnalysis | null
  status: TextStatus
  error: string | null
  onAnalyze: () => void
  onOpenEntry: (id: number) => void
}

const EXAMPLE =
  'Ich ging gestern mit meinen Freunden in die Stadt. Wir haben eine Wasserflasche gekauft und im Garten gegessen.'

/** Entry row used by the selected-word panel and by the word list. */
function EntryRow({
  entry,
  note,
  onOpen,
}: {
  entry: Pick<TextCandidate, 'id' | 'word' | 'pos' | 'article' | 'gloss'>
  note?: string
  onOpen: (id: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-card border border-card-edge-strong bg-card px-3 py-2 text-left transition-colors hover:border-violet-500/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-base font-semibold text-slate-100">{entry.word}</span>
        <ArticleChips article={entry.article} />
        <PosPill pos={entry.pos} />
        {note && <span className="text-xs text-slate-400">{note}</span>}
      </span>
      {entry.gloss && (
        <span className="text-sm text-slate-300">{entry.gloss}</span>
      )}
    </button>
  )
}

function wordClass(token: TextToken, selected: boolean): string {
  const base =
    'cursor-pointer rounded-sm px-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'
  const look = token.candidates?.length
    ? 'border-b border-dotted border-violet-400/60 hover:bg-violet-900/30'
    : token.compound
      ? 'border-b border-dashed border-amber-400/60 hover:bg-amber-900/30'
      : 'text-slate-500 hover:bg-slate-800/60'
  return `${base} ${look} ${selected ? 'bg-violet-900/40' : ''}`
}

export function TextView({
  text,
  onTextChange,
  analysis,
  status,
  error,
  onAnalyze,
  onOpenEntry,
}: TextViewProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const tokens = useMemo(() => analysis?.tokens ?? [], [analysis])
  const token = selected !== null ? tokens[selected] : undefined

  // Distinct dictionary entries of the text, in order of first appearance
  const vocabulary = useMemo(() => {
    const seen = new Map<number, { entry: TextCandidate | TextPart; count: number }>()
    for (const t of tokens) {
      if (!t.word) continue
      const entries: (TextCandidate | TextPart)[] = t.candidates?.[0]
        ? [t.candidates[0]]
        : (t.compound ?? [])
      for (const entry of entries) {
        const found = seen.get(entry.id)
        if (found) found.count++
        else seen.set(entry.id, { entry, count: 1 })
      }
    }
    return [...seen.values()]
  }, [tokens])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onAnalyze()
    }
  }

  const tooLong = text.length > MAX_TEXT_LENGTH
  const canAnalyze = text.trim().length > 0 && !tooLong && status !== 'loading'

  return (
    <section>
      <h2 className="text-2xl font-semibold text-white">Analyze a text</h2>
      <p className="mt-1 text-sm text-slate-400">
        Paste German text to see the dictionary form of every word. Select a word for its
        meaning.
      </p>

      <textarea
        id="text-input"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Paste or type German text…"
        aria-label="German text to analyze"
        rows={6}
        spellCheck={false}
        className="mt-4 block w-full resize-y rounded-card border border-card-edge bg-card p-4 text-base leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-500/50"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${tooLong ? 'text-rose-400' : 'text-slate-500'}`}>
          {text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          {text.trim() === '' && (
            <button
              type="button"
              onClick={() => onTextChange(EXAMPLE)}
              className="min-h-10 cursor-pointer rounded-card px-3 text-sm text-slate-400 underline transition-colors hover:text-violet-400"
            >
              Try an example
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSelected(null)
              onAnalyze()
            }}
            disabled={!canAnalyze}
            title="Ctrl + Enter"
            className="min-h-10 cursor-pointer rounded-card border border-violet-500/60 bg-violet-900/30 px-4 text-sm font-semibold text-violet-200 transition-colors enabled:hover:bg-violet-900/50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            {status === 'loading' ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </div>

      {status === 'error' && error && (
        <p className="mt-4 text-sm text-rose-400">{error}</p>
      )}

      {analysis && (
        <div className="mt-6">
          <p className="mb-2 text-sm text-slate-400">
            {analysis.stats.words} words · {analysis.stats.unique} different
            {analysis.stats.unknown > 0 && ` · ${analysis.stats.unknown} not found`}
          </p>

          <div className="rounded-card border border-card-edge bg-card p-4 sm:p-6">
            <p className="whitespace-pre-wrap text-lg leading-[2.1] text-slate-100 [overflow-wrap:anywhere]">
              {tokens.map((t, i) =>
                t.word ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelected(i)}
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
          </div>

          {token && (
            <div className="sticky bottom-3 z-10 mt-3 rounded-card border border-card-edge-strong bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="text-xl font-semibold text-white [overflow-wrap:anywhere]">
                  {token.text}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="-m-2 cursor-pointer p-2 text-slate-400 transition-colors hover:text-violet-400"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {token.candidates?.map((c) => (
                  <EntryRow
                    key={c.id}
                    entry={c}
                    note={c.viaForm ? `form of ${c.word}` : undefined}
                    onOpen={onOpenEntry}
                  />
                ))}
                {!token.candidates?.length && token.compound && (
                  <>
                    <p className="text-sm text-amber-300">
                      Compound word: {token.compound.map((p) => p.word).join(' + ')}
                    </p>
                    {token.compound.map((p) => (
                      <EntryRow key={p.id} entry={p} onOpen={onOpenEntry} />
                    ))}
                  </>
                )}
                {!token.candidates?.length && !token.compound && (
                  <p className="text-sm text-slate-400">
                    No dictionary entry found for this word.
                  </p>
                )}
              </div>
            </div>
          )}

          {vocabulary.length > 0 && (
            <section className="mt-6">
              <h3 className="mb-2 text-sm font-normal text-slate-300">
                Words in this text ({vocabulary.length})
              </h3>
              <ul className="flex flex-col gap-2">
                {vocabulary.slice(0, 300).map(({ entry, count }) => (
                  <li key={entry.id}>
                    <EntryRow
                      entry={entry}
                      note={count > 1 ? `×${count}` : undefined}
                      onOpen={onOpenEntry}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  )
}
