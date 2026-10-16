/**
 * English tokenisation for reverse (English -> German) search.
 *
 * MUST stay equivalent to `english_words` in ingest/ingest.py: a multi-word query is cut into
 * words exactly like the glosses were when the `kind 3` search keys were built, so every query
 * word can be looked up as a key. ingest/fixtures/english_cases.json checks both ports.
 */

// Words that carry no meaning on their own (see ENGLISH_STOPWORDS in ingest.py). Content words
// such as "be", "have" or "not" are deliberately kept.
const STOPWORDS = new Set(
  `a an the of in on at by for with from into onto and or as to it its
   that which who whom whose this these those
   one ones oneself someone somebody something someones somebodys somethings
   etc eg ie`.split(/\s+/),
);

const QUALIFIER_RE = /\([^)]*\)|\[[^\]]*\]/g;
const TOKEN_RE = /[a-z]+(?:'[a-z]+)?/g;

/** Maximum number of distinct words of a query that are looked up. */
export const MAX_QUERY_WORDS = 5;

export function englishWords(text: string): string[] {
  const clean = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(QUALIFIER_RE, " ")
    .trim();
  const out: string[] = [];
  for (const match of clean.matchAll(TOKEN_RE)) {
    let token = match[0];
    if (token.endsWith("'s")) token = token.slice(0, -2);
    if (STOPWORDS.has(token) || token.endsWith("'")) continue;
    if (token.length < 2 && token !== "i") continue; // keep "I" (ich), drop stray letters
    out.push(token);
  }
  return out;
}

/**
 * The distinct English words of a search query, or none when the query cannot be English:
 * a query with letters outside a-z (a German word such as "schön") is not cut into pieces.
 */
export function queryEnglishWords(query: string): string[] {
  if (/[^\u0000-\u007f]/.test(query)) return [];
  return [...new Set(englishWords(query))].slice(0, MAX_QUERY_WORDS);
}
