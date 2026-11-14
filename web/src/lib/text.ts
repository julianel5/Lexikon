/**
 * Characters that are invisible inside a word but split it: the soft hyphen that dictionaries
 * such as Duden put at every syllable break, zero-width spaces and joiners, the word joiner and a
 * stray byte-order mark. A word pasted with them ("Mord\u00adpro\u00adzess") is the same word, so
 * they are removed from the search box (the server removes them too).
 */
const INVISIBLE_RE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, '')
}
