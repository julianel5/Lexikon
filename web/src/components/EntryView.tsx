import { useEffect, useRef, useState } from 'react'
import type { Entry, RelationItem, RelationKey } from '../lib/api'
import { morphFields } from '../lib/morphology'
import { playNormalized } from '../lib/normalizedAudio'
import { useEntry } from '../lib/useEntry'
import { ArticleChips } from './ArticleChips'

interface EntryViewProps {
  id: number
  onSelectTerm: (term: string) => void
  /** Called once the entry has been fetched (used to sync the URL). */
  onLoaded?: (entry: Entry) => void
  /** Called when the id no longer exists (404). */
  onMissing?: () => void
}

const RELATION_LABELS: { key: RelationKey; label: string }[] = [
  { key: 'synonyms', label: 'Synonyms' },
  { key: 'antonyms', label: 'Antonyms' },
  { key: 'derived', label: 'Derived' },
  { key: 'related', label: 'Related' },
  { key: 'hypernyms', label: 'Hypernyms' },
  { key: 'hyponyms', label: 'Hyponyms' },
  { key: 'holonyms', label: 'Holonyms' },
  { key: 'meronyms', label: 'Meronyms' },
  { key: 'coordinate_terms', label: 'Coordinate terms' },
]

/** Drop malformed strings (lone surrogates / U+FFFD) from the kaikki IPA data. */
function isWellFormed(s: string): boolean {
  const withoutPairs = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
  return !/[\uD800-\uDFFF]/.test(withoutPairs)
}

function ipasOf(entry: Entry): string[] {
  return (entry.sounds ?? [])
    .map((s) => s.ipa)
    .filter((ipa): ipa is string => Boolean(ipa) && isWellFormed(ipa))
    .slice(0, 3)
}

function relationSections(entry: Entry): { label: string; items: RelationItem[] }[] {
  const sections: { label: string; items: RelationItem[] }[] = []
  for (const { key, label } of RELATION_LABELS) {
    const items = entry[key]
    if (!Array.isArray(items) || items.length === 0) continue
    const seen = new Set<string>()
    const unique = items.filter((item) => {
      if (!item?.word || seen.has(item.word)) return false
      seen.add(item.word)
      return true
    })
    if (unique.length) sections.push({ label, items: unique })
  }
  return sections
}

function PosBadge({ pos }: { pos: string }) {
  return (
    <span className="rounded-xl border border-violet-800 bg-violet-950/80 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-violet-300">
      {pos}
    </span>
  )
}

function FormBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-stretch">
      <span className="rounded-l-xl border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="rounded-r-xl border border-l-0 border-slate-700/60 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
        {value}
      </span>
    </span>
  )
}

function EntryDetails({
  entry,
  onSelectTerm,
}: {
  entry: Entry
  onSelectTerm: (term: string) => void
}) {
  const fields = morphFields(entry)
  const ipas = ipasOf(entry)
  const senses = entry.senses ?? []
  const relations = relationSections(entry)

  const [isPlaying, setIsPlaying] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const stopAudioRef = useRef<(() => void) | null>(null)
  const playTokenRef = useRef(0)

  // Track the available voices (they load asynchronously in most browsers).
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const loadVoices = () => setVoices(synth.getVoices())
    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)
    return () => synth.removeEventListener('voiceschanged', loadVoices)
  }, [])

  // Stop any sound when leaving the entry or switching to a different word.
  useEffect(() => {
    return () => {
      // playTokenRef is a plain counter (not a DOM node), so reading the
      // latest value on cleanup is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playTokenRef.current++
      stopAudioRef.current?.()
      stopAudioRef.current = null
      window.speechSynthesis?.cancel()
    }
  }, [entry.word])

  const germanVoices = voices.filter((v) =>
    v.lang.replace('_', '-').toLowerCase().startsWith('de'),
  )
  const clips = (entry.audio ?? []).filter((c) => c.mp3 || c.ogg)
  const canSpeak = germanVoices.length > 0
  // A recording always works; TTS only if a German voice is installed.
  // Never speak with a non-German voice: it mispronounces (Mädchen -> "machen").
  const canPlay = clips.length > 0 || canSpeak

  const speak = () => {
    const synth = window.speechSynthesis
    const german =
      germanVoices.find(
        (v) => v.lang.replace('_', '-').toLowerCase() === 'de-de',
      ) ?? germanVoices[0]
    if (!synth || !german) return

    // Cancel anything already playing so utterances never overlap.
    synth.cancel()
    synth.resume() // Chrome can leave the engine in a "paused" state

    const utterance = new SpeechSynthesisUtterance(entry.word)
    utterance.lang = 'de-DE'
    utterance.rate = 0.95
    utterance.voice = german

    utterance.onstart = () => setIsPlaying(true)
    utterance.onend = () => setIsPlaying(false)
    utterance.onerror = () => setIsPlaying(false)

    // Keep a reference so the utterance isn't garbage-collected, and give
    // cancel() a tick — Chrome drops an utterance spoken in the same tick.
    utteranceRef.current = utterance
    window.setTimeout(() => synth.speak(utterance), 60)
  }

  const playAudio = () => {
    // Invalidate any clip that is still loading and stop whatever is playing.
    const token = ++playTokenRef.current
    stopAudioRef.current?.()
    stopAudioRef.current = null
    window.speechSynthesis?.cancel()

    // Prefer a real recording; fall back to a German TTS voice if one exists.
    const clip = clips[0]
    const src = clip?.mp3 ?? clip?.ogg
    if (!src) {
      speak()
      return
    }
    setIsPlaying(true)
    playNormalized(src, () => setIsPlaying(false))
      .then((stop) => {
        if (token !== playTokenRef.current) {
          stop()
          return
        }
        stopAudioRef.current = stop
      })
      .catch(() => {
        if (token !== playTokenRef.current) return
        setIsPlaying(false)
        speak()
      })
  }

  return (
    <article className="flex flex-col gap-8">
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 text-4xl font-black tracking-tight text-white [overflow-wrap:anywhere] sm:text-5xl md:text-6xl">
            {entry.word}
          </h2>
          <button
            type="button"
            onClick={playAudio}
            disabled={!canPlay}
            aria-label="Listen to pronunciation"
            title={
              canPlay
                ? 'Listen to pronunciation'
                : 'No recording or German voice available on this device'
            }
            className={`-m-2 p-2 transition-colors enabled:cursor-pointer enabled:hover:text-violet-400 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
              isPlaying ? 'animate-pulse text-violet-400' : 'text-slate-500'
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          </button>
        </div>

        {ipas.length > 0 && (
          <p className="mt-1 font-mono text-lg text-slate-400">
            {ipas.join('  ·  ')}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <PosBadge pos={entry.pos} />
          <ArticleChips article={entry.article} />
          {entry.separable && (
            <span className="rounded-xl border border-amber-800 bg-amber-950/80 px-2.5 py-1 text-xs font-bold uppercase tracking-widest text-amber-300">
              separable
            </span>
          )}
          {!entry.article && entry.gender && (
            <span className="rounded-xl border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-bold uppercase tracking-widest text-slate-300">
              {entry.gender}
            </span>
          )}
          {fields.map((field) => (
            <FormBadge
              key={field.label}
              label={field.label}
              value={field.value}
            />
          ))}
        </div>
      </header>

      {senses.length > 0 && (
        <ol className="flex list-decimal flex-col gap-5 pl-6 marker:font-semibold marker:text-violet-500/70">
          {senses.map((sense, i) => (
            <li key={i} className="pl-1">
              <p className="text-[1.05rem] font-semibold leading-relaxed text-slate-100">
                {sense.glosses[0]}
                {sense.glosses.slice(1).map((gloss, gi) => (
                  <span key={gi} className="font-normal text-slate-400">
                    , {gloss}
                  </span>
                ))}
              </p>
              {sense.examples?.map((example, ei) => (
                <blockquote
                  key={ei}
                  className="mt-2 flex flex-col gap-1 rounded-r-xl border-l-2 border-violet-500 bg-slate-900/40 py-2.5 pl-4 pr-3 text-sm italic text-slate-300 transition-all duration-300 hover:bg-slate-900/60"
                >
                  <span>{example.text}</span>
                  {example.en && (
                    <span className="text-slate-500">{example.en}</span>
                  )}
                </blockquote>
              ))}
            </li>
          ))}
        </ol>
      )}

      {relations.map((section) => (
        <section key={section.label}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {section.label}
          </h3>
          <div className="flex flex-wrap gap-2">
            {section.items.map((item) => (
              <button
                key={item.word}
                type="button"
                onClick={() => onSelectTerm(item.word)}
                className="flex min-h-9 max-w-full cursor-pointer items-center rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-left text-xs font-medium [overflow-wrap:anywhere] text-slate-300 transition-all duration-300 hover:border-violet-800/50 hover:bg-violet-950/40 hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              >
                {item.word}
                {item.roman && (
                  <span className="ml-1 text-slate-500">· {item.roman}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </article>
  )
}

export function EntryView({
  id,
  onSelectTerm,
  onLoaded,
  onMissing,
}: EntryViewProps) {
  const { entry, status, error, notFound } = useEntry(id)

  // Callbacks are kept out of the deps on purpose: they only need to fire
  // when the loaded entry (or a 404) changes, not on every parent render.
  useEffect(() => {
    if (entry && status === 'ready') onLoaded?.(entry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, status])

  useEffect(() => {
    if (notFound) onMissing?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound])

  return (
    <section className="animate-fade-in-up">
      {status === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}

      {status === 'error' && (
        <p className="text-sm text-rose-400">
          {error ?? 'Could not load this entry.'}
        </p>
      )}

      {entry && status === 'ready' && (
        <EntryDetails entry={entry} onSelectTerm={onSelectTerm} />
      )}
    </section>
  )
}
