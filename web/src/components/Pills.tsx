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
