import { useEffect, useState } from 'react'
import { analyzeText, type TextAnalysis } from './api'

/** Longest query that is analyzed as a sentence (the API accepts more; a search box needs less). */
export const MAX_SENTENCE_LENGTH = 1000

export function countWords(text: string): number {
  return text.match(/\p{L}+/gu)?.length ?? 0
}

/**
 * Segments a multi-word query into words and dictionary entries (POST /api/parse). With
 * `singleWord`, a one-word query is analysed too (a word the dictionary does not have, which may
 * be a compound of words it has).
 * Only the analysis of the *current* query is returned, so a slow answer for an older query
 * never shows up under a newer one.
 */
export function useSentence(query: string, singleWord = false): TextAnalysis | null {
  const [done, setDone] = useState<{ query: string; analysis: TextAnalysis } | null>(null)
  const words = countWords(query)
  const eligible = (words >= 2 || (singleWord && words === 1)) && query.length <= MAX_SENTENCE_LENGTH

  useEffect(() => {
    if (!eligible) return
    const controller = new AbortController()
    analyzeText(query, controller.signal)
      .then((analysis) => setDone({ query, analysis }))
      .catch(() => {
        /* the normal search results stay on screen */
      })
    return () => controller.abort()
  }, [query, eligible])

  return eligible && done?.query === query ? done.analysis : null
}
