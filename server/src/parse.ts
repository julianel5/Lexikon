/**
 * Text analysis: cut a German text into words and resolve every word to the dictionary entries
 * it can be (its lemma), including inflected forms ("ging" -> gehen) and, as a fallback, German
 * compounds ("Wasserflasche" -> Wasser + Flasche).
 *
 * The database access is injected (see `Lookup`), so the logic can be tested without a database.
 */

export const MAX_TEXT_LENGTH = 5000;
/** Unknown words are decomposed at most this many times per request (each costs a few lookups). */
const MAX_DECOMPOSITIONS = 150;
const MAX_CANDIDATES = 5;
const MIN_PART_LENGTH = 3;

export interface Candidate {
  id: number;
  word: string;
  pos: string;
  article: string | null;
  gloss: string | null;
  /** true when the text word is an inflected form of this entry ("ging" -> gehen) */
  viaForm: boolean;
}

export interface RawCandidate {
  id: number;
  word: string;
  pos: string;
  article: string | null;
  gloss: string | null;
  /** 1 when the key is the entry's own headword, 0 when it is one of its inflected forms */
  headword: number;
  /** size of the entry: a cheap "how common / how documented" signal */
  weight: number;
}

export interface Lookup {
  /** Entries that have `key` (lower-cased) as their headword or as an inflected form. */
  candidates(key: string): RawCandidate[];
  /** The best entry whose HEADWORD is `key` and that can be part of a compound, or null. */
  headword(key: string): Omit<Candidate, "viaForm"> | null;
}

export interface Part {
  /** the piece of the word, lower-cased (after removing a linking element) */
  text: string;
  id: number;
  word: string;
  pos: string;
  article: string | null;
  gloss: string | null;
}

export interface Token {
  text: string;
  start: number;
  end: number;
  word: boolean;
  candidates?: Candidate[];
  compound?: Part[];
}

export interface Analysis {
  tokens: Token[];
  stats: { words: number; unique: number; unknown: number };
}

// Letters (any script, so umlauts and ß), optionally joined by hyphens/apostrophes: "E-Mail", "geht's"
const WORD_RE = /\p{L}+(?:['’-]\p{L}+)*/gu;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      tokens.push({ text: text.slice(last, start), start: last, end: start, word: false });
    }
    const end = start + match[0].length;
    tokens.push({ text: match[0], start, end, word: true });
    last = end;
  }
  if (last < text.length) {
    tokens.push({ text: text.slice(last), start: last, end: text.length, word: false });
  }
  return tokens;
}

const NOUNISH = new Set(["noun", "name"]);

// Entries that only point at another spelling or form ("alternative form of wir", "obsolete
// spelling of ...", "dialectal variant of ...") are rarely what the reader meant.
const SECONDARY_GLOSS_RE =
  /^(?:\S+\s+){0,3}?(?:form|spelling|variant|abbreviation|initialism|acronym|clipping|misspelling)\s+of\b/i;

// Prior of each part of speech: in a running text the closed classes (articles, prepositions,
// pronouns...) are by far the most frequent words, so "die" is the article before it is a rare
// verb form, and "eine" is ein before it is "einen" (to unite). Without a frequency list this
// is the best cheap signal; a real list would replace it.
const POS_PRIOR: Record<string, number> = {
  article: 6,
  det: 5,
  prep: 4,
  conj: 4,
  pron: 3,
  contraction: 3,
  particle: 2,
  num: 1,
  adv: 1,
  intj: -1,
  name: -3,
  phrase: -2,
  proverb: -4,
  prefix: -6,
  suffix: -6,
  character: -6,
  symbol: -6,
  punct: -6,
};

/** Order the entries a word can be, most likely first. */
export function rankCandidates(
  raw: RawCandidate[],
  surface: string,
  sentenceStart: boolean,
): Candidate[] {
  const capitalized = surface.charAt(0) !== surface.charAt(0).toLowerCase();
  const scored = raw.map((c) => {
    // A headword match is a hint, not a verdict: "die" has no entry of its own and is a form of
    // der/die/das, while "mir" has a rarely used headword entry next to its real lemma ich.
    let score = c.headword ? 4 : 0;
    score += POS_PRIOR[c.pos] ?? 0;
    if (c.gloss && SECONDARY_GLOSS_RE.test(c.gloss)) score -= 10;
    // An all-capitals entry ("IM") is an abbreviation; it does not explain a lower-case "im"
    const lemmaCaps = c.word.length > 1 && c.word === c.word.toUpperCase() && c.word !== c.word.toLowerCase();
    if (!capitalized && lemmaCaps) score -= 8;
    // The capital of a sentence's first word says nothing: prefer the lower-case lemma
    // ("Ich" -> ich) over a capitalised noun that happens to be spelled the same.
    if (capitalized && sentenceStart && c.word.charAt(0) === c.word.charAt(0).toLowerCase()) score += 3;
    // German nouns are capitalised: a capital letter inside a sentence points to a noun,
    // a lower-case word is rarely one. At the start of a sentence the capital says nothing.
    if (capitalized && !sentenceStart) score += NOUNISH.has(c.pos) ? 8 : -4;
    if (!capitalized) score += NOUNISH.has(c.pos) ? -4 : 0;
    return { c, score: score + Math.log10(Math.max(c.weight, 1)) };
  });
  scored.sort((a, b) => b.score - a.score || a.c.word.localeCompare(b.c.word));
  return scored.slice(0, MAX_CANDIDATES).map(({ c }) => ({
    id: c.id,
    word: c.word,
    pos: c.pos,
    article: c.article,
    gloss: c.gloss,
    viaForm: c.headword === 0,
  }));
}

// Linking elements ("Fugenelemente") that may sit between the parts of a compound, and the
// verb ending that a stem needs to become a headword: Schreib|tisch -> schreib + en.
const LINKING = ["ens", "es", "en", "ns", "er", "s", "n", "e"];

function leftVariants(piece: string): string[] {
  const out = [piece, `${piece}en`];
  for (const link of LINKING) {
    if (piece.endsWith(link) && piece.length - link.length >= MIN_PART_LENGTH) {
      out.push(piece.slice(0, -link.length));
    }
  }
  return out;
}

/**
 * Split an unknown word into known parts, e.g. "wasserflasche" -> [wasser, flasche]. The right
 * part must be a headword (in German the last part decides the meaning); the longest right part
 * wins. Returns null when no split with parts of at least three letters is found.
 */
export function decompose(
  word: string,
  lookup: Lookup,
  depth = 0,
  cache = new Map<string, Omit<Candidate, "viaForm"> | null>(),
): Part[] | null {
  const head = (key: string) => {
    if (!cache.has(key)) cache.set(key, lookup.headword(key));
    return cache.get(key) ?? null;
  };
  const part = (text: string, e: Omit<Candidate, "viaForm">): Part => ({
    text,
    id: e.id,
    word: e.word,
    pos: e.pos,
    article: e.article,
    gloss: e.gloss,
  });

  for (let i = MIN_PART_LENGTH; i <= word.length - MIN_PART_LENGTH; i++) {
    const right = head(word.slice(i));
    if (!right) continue;
    for (const left of leftVariants(word.slice(0, i))) {
      const leftEntry = head(left);
      if (leftEntry) return [part(left, leftEntry), part(word.slice(i), right)];
      if (depth < 2) {
        const sub = decompose(left, lookup, depth + 1, cache);
        if (sub) return [...sub, part(word.slice(i), right)];
      }
    }
  }
  return null;
}

/** The first letter after one of . ! ? (or at the start of the text) begins a sentence. */
function startsSentence(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const ch = text.charAt(i);
    if (/\s|["'«»„“”‚‘’(\[]/u.test(ch)) continue;
    return ch === "." || ch === "!" || ch === "?" || ch === ":" || ch === "\n";
  }
  return true;
}

export function analyzeText(text: string, lookup: Lookup): Analysis {
  const tokens = tokenize(text);
  const known = new Map<string, Candidate[]>();
  const compounds = new Map<string, Part[] | null>();
  const headCache = new Map<string, Omit<Candidate, "viaForm"> | null>();
  const seen = new Set<string>();
  let decompositions = 0;
  let words = 0;
  let unknown = 0;

  for (const token of tokens) {
    if (!token.word) continue;
    words++;
    const key = token.text.normalize("NFC").toLowerCase().replace(/’/g, "'");
    seen.add(key);

    const sentenceStart = startsSentence(text, token.start);
    // The ranking depends on capitalisation, so it is cached per surface form
    const cacheKey = `${sentenceStart ? 1 : 0}|${token.text}`;
    let candidates = known.get(cacheKey);
    if (!candidates) {
      candidates = rankCandidates(lookup.candidates(key), token.text, sentenceStart);
      known.set(cacheKey, candidates);
    }
    if (candidates.length > 0) {
      token.candidates = candidates;
      continue;
    }

    // Unknown word: try a compound split ("Wasserflasche") or the parts of a hyphenated word
    if (!compounds.has(key) && decompositions < MAX_DECOMPOSITIONS) {
      decompositions++;
      let parts: Part[] | null = null;
      if (key.includes("-")) {
        const pieces = key.split("-").filter(Boolean);
        const resolved = pieces.map((piece) => {
          const e = lookup.headword(piece);
          return e && { text: piece, id: e.id, word: e.word, pos: e.pos, article: e.article, gloss: e.gloss };
        });
        if (resolved.length > 1 && resolved.every(Boolean)) parts = resolved as Part[];
      } else {
        parts = decompose(key, lookup, 0, headCache);
      }
      compounds.set(key, parts);
    }
    const parts = compounds.get(key);
    if (parts) token.compound = parts;
    else unknown++;
  }

  return { tokens, stats: { words, unique: seen.size, unknown } };
}
