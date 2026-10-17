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
/** Multi-word forms ("stehe auf" -> aufstehen) cost at most this many extra lookups. */
const MAX_PHRASE_LOOKUPS = 200;
const MAX_CANDIDATES = 5;
const MIN_PART_LENGTH = 3;
/** Longest multi-word form to try, in words ("ruf mich an" would be 3, if it were indexed). */
const MAX_PHRASE_WORDS = 3;

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
  /** occurrences of the entry in a word frequency list; 0 or absent when it has no frequency */
  freq?: number;
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
  /**
   * Candidates from a multi-word form whose first word is this token ("stehe auf" -> aufstehen).
   * Only set when the phrase is also in the dictionary; the single-word candidates stay on
   * their own tokens so both readings are always visible.
   */
  phrase?: Candidate[];
  /** index of the first token of a multi-word form this token continues ("stehe" + "auf") */
  phraseCont?: number;
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

// How much the (base 10) logarithm of an entry's frequency counts: one point per power of ten.
const FREQ_WEIGHT = 1;
// When frequencies are known the size of an entry only breaks ties. It is a poor stand-in for
// frequency: Wiktionary's "er" and "es" are ten times bigger than "ich", but "ich" is used more.
const SIZE_TIEBREAK = 0.01;

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
  // A database built without a frequency list gives every entry 0: then the size of the entry
  // is the only popularity signal there is, as before.
  const haveFrequencies = raw.some((c) => (c.freq ?? 0) > 0);
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
    const size = Math.log10(Math.max(c.weight, 1));
    score += haveFrequencies
      ? FREQ_WEIGHT * Math.log10((c.freq ?? 0) + 1) + SIZE_TIEBREAK * size
      : size;
    return { c, score };
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
  const wordIndices: number[] = [];
  let decompositions = 0;
  let words = 0;
  let unknown = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.word) continue;
    words++;
    wordIndices.push(i);
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

  // Multi-word forms ("stehe auf" -> aufstehen): join adjacent words into a phrase and look it
  // up. The phrase candidates go on the first word; the following words only record that they
  // continue it, so every word keeps its own single-word reading too.
  let phraseLookups = 0;
  const consumed = new Set<number>();
  const phraseCache = new Map<string, Candidate[]>();
  for (let w = 0; w < wordIndices.length && phraseLookups < MAX_PHRASE_LOOKUPS; w++) {
    const first = wordIndices[w]!;
    if (consumed.has(first)) continue;
    // Try the longest phrase first so "ruf mich an" wins over a shorter "ruf mich".
    for (let n = Math.min(MAX_PHRASE_WORDS, wordIndices.length - w); n >= 2; n--) {
      const parts = wordIndices.slice(w, w + n);
      // only words separated by whitespace form a phrase; punctuation breaks it
      let contiguous = true;
      for (let p = 0; p + 1 < parts.length; p++) {
        const between = tokens.slice(parts[p]! + 1, parts[p + 1]!);
        if (!between.every((t) => !t.word && /^\s+$/u.test(t.text))) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) break;
      const surface = parts.map((i) => tokens[i]!.text).join(" ");
      const phrase = surface.normalize("NFC").toLowerCase().replace(/’/g, "'");
      phraseLookups++;
      // The ranking depends on capitalisation, so it is cached per surface form, as for one word
      const sentenceStart = startsSentence(text, tokens[first]!.start);
      const phraseKey = `${sentenceStart ? 1 : 0}|${surface}`;
      let ranked = phraseCache.get(phraseKey);
      if (ranked === undefined) {
        // A phrase key is never a headword ("stehe auf" is only a form of aufstehen), so rank
        // on the first word: the phrase inherits its capitalisation and sentence position.
        ranked = rankCandidates(lookup.candidates(phrase), surface, sentenceStart);
        phraseCache.set(phraseKey, ranked);
      }
      if (ranked.length === 0) continue;
      tokens[first]!.phrase = ranked;
      for (let k = 0; k < n; k++) {
        const index = wordIndices[w + k]!;
        const tok = tokens[index]!;
        // a word that is unknown alone but resolves as part of the phrase is found in context
        if (!tok.candidates?.length && !tok.compound?.length) unknown--;
        if (k > 0) tok.phraseCont = first;
        consumed.add(index);
      }
      break;
    }
  }

  return { tokens, stats: { words, unique: seen.size, unknown } };
}
