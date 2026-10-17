export const REPO_URL = 'https://github.com/julianel5/Lexikon'

/** The "wrong or missing entry" issue form, with the word and the page already filled in. */
export function reportEntryUrl(word: string, path: string): string {
  const params = new URLSearchParams({
    template: 'wrong_entry.yml',
    title: `Wrong or missing entry: ${word}`,
    word,
    url: path,
  })
  return `${REPO_URL}/issues/new?${params.toString()}`
}

/** The issue chooser, for a problem that is not about one entry. */
export const REPORT_PROBLEM_URL = `${REPO_URL}/issues/new/choose`
