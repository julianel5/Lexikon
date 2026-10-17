import { Fragment, useState } from 'react'
import type { Entry, Form } from '../lib/api'

function hasTag(tags: string[] | undefined, needle: string) {
  if (!tags) return false
  const n = needle.toLowerCase()
  return tags.some((t) => t.toLowerCase().includes(n))
}

function getCase(tags: string[] | undefined): string {
  if (!tags) return ''
  const t = tags.map((x) => x.toLowerCase())
  if (t.some((x) => x.includes('nominative'))) return 'Nom'
  if (t.some((x) => x.includes('accusative'))) return 'Acc'
  if (t.some((x) => x.includes('dative'))) return 'Dat'
  if (t.some((x) => x.includes('genitive'))) return 'Gen'
  if (t.some((x) => x.includes('vocative'))) return 'Voc'
  return ''
}

function getNumber(tags: string[] | undefined): string {
  if (!tags) return ''
  const t = tags.map((x) => x.toLowerCase())
  if (t.some((x) => x.includes('plural'))) return 'Plur'
  if (t.some((x) => x.includes('singular'))) return 'Sing'
  return ''
}

function getTenseGroup(tags: string[] | undefined): string {
  if (!tags) return 'Other'
  const t = tags.map((x) => x.toLowerCase())
  if (t.some((x) => x.includes('future perfect') || x.includes('future-perfect'))) return 'Future Perfect'
  if (t.some((x) => x.includes('future'))) return 'Future'
  if (t.some((x) => x.includes('pluperfect') || x.includes('plusquamperfect'))) return 'Pluperfect'
  if (t.some((x) => x.includes('perfect'))) return 'Perfect'
  if (t.some((x) => x.includes('preterite') || x.includes('past'))) return 'Preterite/Präteritum'
  if (t.some((x) => x.includes('present') || x.includes('präsens'))) return 'Präsens'
  if (t.some((x) => x.includes('subjunctive') || x.includes('subj') || x.includes('konjunktiv'))) return 'Subjunctive/Konjunktiv'
  if (t.some((x) => x.includes('conditional'))) return 'Conditional'
  if (t.some((x) => x.includes('imperative'))) return 'Imperative'
  if (t.some((x) => x.includes('participle'))) return 'Participle'
  if (t.some((x) => x.includes('infinitive'))) return 'Infinitive'
  return 'Other'
}

function getPerson(tags: string[] | undefined): string {
  if (!tags) return ''
  const t = tags.map((x) => x.toLowerCase())
  if (t.some((x) => x.includes('first-person') || x === '1st' || x.includes('1st-person'))) return '1st'
  if (t.some((x) => x.includes('second-person') || x === '2nd' || x.includes('2nd-person'))) return '2nd'
  if (t.some((x) => x.includes('third-person') || x === '3rd' || x.includes('3rd-person'))) return '3rd'
  return ''
}

interface MorphologyTableProps {
  entry: Entry
}

export function MorphologyTable({ entry }: MorphologyTableProps) {
  const [open, setOpen] = useState(false)
  const forms = entry.forms ?? []
  const pos = (entry.pos ?? '').toLowerCase()

  const nounLike = pos === 'noun' || pos === 'name' || pos === 'proper noun' || pos === 'adjective' || pos === 'adj'

  const cases = ['Nom', 'Acc', 'Dat', 'Gen']
  const numbers = ['Sing', 'Plur']

  const declension: Record<string, Record<string, Form[]>> = {}
  for (const c of cases) declension[c] = { Sing: [], Plur: [] }
  let hasDecl = false
  if (nounLike) {
    for (const f of forms) {
      const c = getCase(f.tags)
      const n = getNumber(f.tags)
      if (c && n && declension[c] && declension[c][n]) {
        declension[c][n].push(f)
        hasDecl = true
      }
    }
  }

  const verbTenses = [
    'Präsens',
    'Preterite/Präteritum',
    'Perfect',
    'Pluperfect',
    'Future',
    'Future Perfect',
    'Subjunctive/Konjunktiv',
    'Conditional',
    'Imperative',
    'Participle',
    'Infinitive',
    'Other',
  ]
  const verbGroups: Record<string, Array<{ person: string; number: string; forms: Form[] }>> = {}
  for (const t of verbTenses) verbGroups[t] = []
  let hasVerb = false
  if (pos === 'verb') {
    for (const f of forms) {
      const tg = getTenseGroup(f.tags)
      const p = getPerson(f.tags)
      const n = getNumber(f.tags) || (hasTag(f.tags, 'plural') ? 'Plur' : hasTag(f.tags, 'singular') ? 'Sing' : '')
      if (tg) {
        verbGroups[tg].push({ person: p, number: n, forms: [f] })
        hasVerb = true
      }
    }
  }

  const hasAny = hasDecl || hasVerb

  if (!hasAny) return null

  return (
    <section className="mt-6 flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex w-fit items-center gap-2 rounded-card border border-card-edge-strong bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 transition-colors hover:border-violet-500/40 hover:text-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      >
        <span>{open ? 'Hide full grammar' : 'Show full grammar'}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-6">
          {hasDecl && (
            <div className="overflow-x-auto rounded-card border border-card-edge-strong bg-card p-4 scrollbar-thin scrollbar-thin-dark">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Declension</h3>
              <div className="grid min-w-[26rem] grid-cols-[minmax(3rem,auto)_repeat(4,minmax(0,1fr))] gap-2 text-sm">
                <div />
                {cases.map((c) => (
                  <div key={c} className="px-2 py-1 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {c}
                  </div>
                ))}
                {numbers.map((n) => (
                  <Fragment key={`num-${n}`}>
                    <div className="flex items-center px-2 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {n}
                    </div>
                    {cases.map((c) => (
                      <div key={`${c}-${n}`} className="flex h-full w-full min-w-0 flex-col justify-center gap-1 rounded-card border border-card-edge bg-card px-3 py-2">
                        {(declension[c][n] as Form[]).length === 0 ? (
                          <span className="text-center text-xs text-slate-600">—</span>
                        ) : (
                          (declension[c][n] as Form[]).map((f, i) => (
                            <span
                              key={i}
                              lang="de"
                              className="break-words hyphens-auto text-center text-sm font-medium leading-tight text-slate-100"
                            >
                              {f.form}
                            </span>
                          ))
                        )}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {hasVerb && (
            <div className="flex flex-col gap-4">
              {verbTenses.map((tg) => {
                const list = verbGroups[tg]
                if (list.length === 0) return null
                return (
                  <div key={tg} className="overflow-x-auto rounded-card border border-card-edge-strong bg-card p-4 scrollbar-thin scrollbar-thin-dark">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{tg}</h3>
                    <div className="grid min-w-[22rem] grid-cols-[auto_auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                      {list.map((row, i) => (
                        <div key={i} className="contents">
                          <div className="flex items-center px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {row.person || '—'}
                          </div>
                          <div className="flex items-center px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {row.number || '—'}
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-1">
                            {row.forms.map((f, j) => (
                              <span
                                key={j}
                                lang="de"
                                className="min-w-0 max-w-full rounded-card bg-slate-800/60 px-2 py-0.5 text-sm font-medium break-words hyphens-auto text-slate-100"
                              >
                                {f.form}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}