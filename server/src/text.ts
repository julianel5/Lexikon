/**
 * Characters that are invisible inside a word but split it for a regex: the soft hyphen that
 * dictionaries such as Duden put at every syllable break ("Mord\u00adpro\u00adzess"), zero-width
 * spaces and joiners, the word joiner and a stray byte-order mark. A query pasted with them is
 * the same word, so they are removed before searching or analysing.
 */
const INVISIBLE_RE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, "");
}
