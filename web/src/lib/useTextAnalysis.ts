import { useCallback, useRef, useState } from 'react'
import { analyzeText, ApiError, type TextAnalysis } from './api'

export type TextStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * State of the "Analyze text" page. It lives in App (not in the page), so opening an entry
 * from a word and coming back with the browser's back button keeps the text and its analysis.
 */
export function useTextAnalysis() {
  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<TextAnalysis | null>(null)
  const [status, setStatus] = useState<TextStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const analyze = useCallback(async () => {
    const value = text
    if (!value.trim()) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setError(null)
    try {
      const result = await analyzeText(value, controller.signal)
      setAnalysis(result)
      setStatus('ready')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(
        err instanceof ApiError && err.status === 413
          ? 'That text is too long.'
          : 'Could not analyze the text. Please try again.',
      )
      setStatus('error')
    }
  }, [text])

  return { text, setText, analysis, status, error, analyze }
}
