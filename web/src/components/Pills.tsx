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

/** "#561": the rank of the word by frequency (1 = the most frequent). Nothing is shown without one. */
export function FreqPill({ rank }: { rank: number | null | undefined }) {
  if (!rank || rank < 1) return null
  const label = `#${rank.toLocaleString('en-US')}`
  return (
    <span
      title={`Frequency rank ${label} in a German web corpus (Leipzig, 2024)`}
      aria-label={`Frequency rank ${rank}`}
      className={`${PILL} bg-slate-800/60 text-slate-300`}
    >
      {label}
    </span>
  )
}
