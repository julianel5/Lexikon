export interface SuggestResult {
  id: number
  word: string
  pos: string
  gender: string | null
  article: string | null
  plural: string | null
  snippet: string
  kind: number
  match: string
  exactForm: boolean
  /** Rank by word frequency (1 = most frequent); null or absent when the entry has none. */
  freqRank?: number | null
}

export interface SuggestResponse {
  query: string
  /** Query the results were actually resolved with (may drop a "sich " prefix). */
  resolvedQuery?: string
  /** True when a leading reflexive pronoun was dropped to match the lemma. */
  reflexFallback?: boolean
  folded: { exact: string; translit: string; strip: string }
  count: number
  results: SuggestResult[]
}

export interface SenseExample {
  text: string
  en?: string
}

export interface Sense {
  glosses: string[]
  tags?: string[]
  topics?: string[]
  examples?: SenseExample[]
}

export interface Form {
  form: string
  tags?: string[]
}

export interface Sound {
  ipa: string
  tags?: string[]
}

/** A native-speaker recording (Wikimedia Commons). mp3 plays everywhere. */
export interface AudioClip {
  mp3?: string
  ogg?: string
  tags?: string[]
}

export interface RelationItem {
  word: string
  roman?: string
  tags?: string[]
  sense?: string
}

export type RelationKey =
  | 'synonyms'
  | 'antonyms'
  | 'derived'
  | 'related'
  | 'hypernyms'
  | 'hyponyms'
  | 'holonyms'
  | 'meronyms'
  | 'coordinate_terms'

export interface Entry {
  id: number
  word: string
  pos: string
  gender: string | null
  article: string | null
  plural: string | null
  forms?: Form[]
  senses?: Sense[]
  sounds?: Sound[]
  audio?: AudioClip[]
  components?: string[]
  auxiliary?: string
  separable?: boolean
  synonyms?: RelationItem[]
  antonyms?: RelationItem[]
  derived?: RelationItem[]
  related?: RelationItem[]
  hypernyms?: RelationItem[]
  hyponyms?: RelationItem[]
  holonyms?: RelationItem[]
  meronyms?: RelationItem[]
  coordinate_terms?: RelationItem[]
  /** How often the word occurs in the frequency list; absent when the database has none. */
  frequency?: { count: number; rank: number }
}

const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export async function fetchSuggest(
  query: string,
  signal: AbortSignal,
): Promise<SuggestResponse> {
  const url = `${API_BASE}/api/suggest?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new ApiError(res.status, `suggest request failed (${res.status})`)
  }
  return (await res.json()) as SuggestResponse
}

export interface AutocompleteItem {
  id: number
  word: string
  pos: string
}

export async function fetchAutocomplete(
  query: string,
  signal: AbortSignal,
): Promise<AutocompleteItem[]> {
  const url = `${API_BASE}/api/autocomplete?q=${encodeURIComponent(query)}&limit=8`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new ApiError(res.status, `autocomplete request failed (${res.status})`)
  }
  const data = (await res.json()) as { suggestions: AutocompleteItem[] }
  return data.suggestions
}

/** A dictionary entry a word of a text can be (its lemma). */
export interface TextCandidate {
  id: number
  word: string
  pos: string
  article: string | null
  gloss: string | null
  /** The word is an inflected form of this entry ("ging" -> gehen). */
  viaForm: boolean
}

/** One piece of a compound word ("Wasserflasche" -> Wasser, Flasche). */
export interface TextPart {
  text: string
  id: number
  word: string
  pos: string
  article: string | null
  gloss: string | null
}

export interface TextToken {
  text: string
  start: number
  end: number
  word: boolean
  candidates?: TextCandidate[]
  compound?: TextPart[]
  /** Entries of a multi-word form starting at this word ("stehe auf" -> aufstehen). */
  phrase?: TextCandidate[]
  /** Index of the first token of a multi-word form this token continues. */
  phraseCont?: number
}

export interface TextAnalysis {
  tokens: TextToken[]
  stats: { words: number; unique: number; unknown: number }
}

/** Longest text the API analyzes (same limit as the server). */
export const MAX_TEXT_LENGTH = 5000

export async function analyzeText(
  text: string,
  signal: AbortSignal,
): Promise<TextAnalysis> {
  const res = await fetch(`${API_BASE}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) {
    throw new ApiError(res.status, `parse request failed (${res.status})`)
  }
  return (await res.json()) as TextAnalysis
}

export async function fetchEntry(
  id: number,
  signal: AbortSignal,
): Promise<Entry> {
  const url = `${API_BASE}/api/entry/${id}`
  const res = await fetch(url, { signal })
  if (res.status === 404) {
    throw new ApiError(404, 'Entry not found.')
  }
  if (!res.ok) {
    throw new ApiError(res.status, `entry request failed (${res.status})`)
  }
  return (await res.json()) as Entry
}
