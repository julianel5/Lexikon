const ARTICLE_STYLES: Record<string, string> = {
  der: 'bg-blue-900/30 text-blue-300',
  die: 'bg-rose-900/30 text-rose-300',
  das: 'bg-emerald-900/30 text-emerald-300',
}

const NEUTRAL = 'bg-slate-800/60 text-slate-300'

interface ArticleChipsProps {
  article: string | null
}

export function ArticleChips({ article }: ArticleChipsProps) {
  if (!article) return null
  const articles = article
    .split('/')
    .map((a) => a.trim())
    .filter(Boolean)

  return (
    <span className="flex items-center gap-1.5">
      {articles.map((a) => (
        <span
          key={a}
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
            ARTICLE_STYLES[a] ?? NEUTRAL
          }`}
        >
          {a}
        </span>
      ))}
    </span>
  )
}
