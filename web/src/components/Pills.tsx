const POS_STYLES: Record<string, string> = {
  verb: 'bg-emerald-900/30 text-emerald-300',
  noun: 'bg-violet-900/30 text-violet-300',
  name: 'bg-violet-900/30 text-violet-300',
  adj: 'bg-amber-900/30 text-amber-300',
  adv: 'bg-cyan-900/30 text-cyan-300',
}

/** Shared look of the small rounded labels (part of speech, article, tags...). */
export const PILL =
  'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider'

export function PosPill({ pos }: { pos: string }) {
  return (
    <span
      className={`${PILL} ${POS_STYLES[pos] ?? 'bg-slate-800/60 text-slate-300'}`}
    >
      {pos}
    </span>
  )
}

/** Frequency ranks are shown in bands, not as exact numbers: the corpus is a sample. */
const FREQUENCY_BANDS = [1000, 2000, 5000, 10000, 20000]

/** The smallest band that holds the rank (1000 for the 1,000 most frequent entries), or null. */
function frequencyBand(rank: number | null | undefined): number | null {
  if (!rank || rank < 1) return null
  return FREQUENCY_BANDS.find((band) => rank <= band) ?? null
}

/** "Top 5k": how common the word is. Nothing is shown for rare words or without frequency data. */
export function FreqPill({ rank }: { rank: number | null | undefined }) {
  const band = frequencyBand(rank)
  if (band === null) return null
  const label = `Top ${band / 1000}k`
  return (
    <span
      title={`Frequency rank #${rank} in a German web corpus (Leipzig, 2024)`}
      aria-label={`${label} most frequent entries, rank ${rank}`}
      className={`${PILL} bg-slate-800/60 text-slate-300`}
    >
      {label}
    </span>
  )
}
