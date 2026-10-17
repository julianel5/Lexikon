import { REPORT_PROBLEM_URL, REPO_URL } from '../lib/links'

const KOFI_URL = 'https://ko-fi.com/muzzijoaquin'
const JULIANEL_URL = 'https://github.com/julianel5'
const FRODOUWU_URL = 'https://github.com/joaquinmuzzi'
const JITEN_URL = 'https://jiten.moe'
const SIRUSH_URL = 'https://github.com/Sirush'

const textLink = 'underline hover:text-violet-400'

/** An icon-only link: no border and no background, a 40 px tap target. */
const iconLink =
  'inline-flex h-10 w-10 items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'

export function Footer() {
  return (
    <footer className="border-t border-slate-800/60 bg-slate-900/40">
      <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-4 py-5">
        <div className="min-w-0 space-y-1 text-xs leading-relaxed text-slate-500">
          <p>
            Site made by:{' '}
            <a
              href={JULIANEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-violet-400 hover:underline"
            >
              Julianel
            </a>{' '}
            and{' '}
            <a
              href={FRODOUWU_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-violet-400 hover:underline"
            >
              Frodouwu
            </a>
            <span aria-hidden="true" className="hidden sm:inline">
              {' · '}
            </span>
            <br className="sm:hidden" />
            Inspired by{' '}
            <a
              href={JITEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              Jiten
            </a>
            , created by{' '}
            <a
              href={SIRUSH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              Sirush
            </a>
          </p>
          <p>
            Dictionary data from{' '}
            <a
              href="https://de.wiktionary.org/"
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              Wiktionary
            </a>{' '}
            via{' '}
            <a
              href="https://kaikki.org/"
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              kaikki.org
            </a>
            , licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              CC BY-SA 4.0
            </a>
            . Word frequencies from the{' '}
            <a
              href="https://wortschatz.uni-leipzig.de/en/download"
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              Leipzig Corpora Collection
            </a>{' '}
            (Universität Leipzig, CC BY). Found a mistake or have an idea?{' '}
            <a
              href={REPORT_PROBLEM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={textLink}
            >
              Tell us on GitHub
            </a>
            .
          </p>
        </div>

        <div className="-mt-2.5 flex shrink-0 items-center">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Lexikon on GitHub"
            title="GitHub"
            className={`${iconLink} text-slate-400 hover:text-violet-400`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-6 w-6"
            >
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
            </svg>
          </a>
          <a
            href={KOFI_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Support Lexikon on Ko-fi"
            title="Ko-fi"
            className={`${iconLink} text-rose-400 hover:text-rose-300`}
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
              <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
              <path d="M6 2v2M10 2v2M14 2v2" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  )
}
