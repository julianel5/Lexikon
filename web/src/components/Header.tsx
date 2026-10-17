import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  /** Go back to the main (search) page with an empty query. */
  onHome: () => void
  /** Go to the search box (keeping the current query) and focus it. */
  onSearch: () => void
}

export function Header({ onHome, onSearch }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/60 bg-slate-900">
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between px-4">
        <h1 className="m-0 text-2xl font-extrabold tracking-tight">
          <a
            href="/"
            onClick={(e) => {
              // Let modified clicks (new tab/window) use the real link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              onHome()
            }}
            className="inline-flex min-h-10 items-center gap-2.5 rounded-lg text-white no-underline transition-colors hover:text-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            {/* decorative: the name next to it is the accessible label */}
            <img src="/favicon.svg" alt="" width={32} height={32} className="h-8 w-8" />
            Lexikon
          </a>
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search words"
            title="Search words (/)"
            aria-keyshortcuts="/"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/40 text-slate-300 transition-colors hover:border-violet-500/50 hover:text-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
