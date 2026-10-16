/**
 * Read-only SQLite access layer.
 *
 * The database is a build artifact produced by ingest/ingest.py and never
 * written to at runtime, so it is opened in read-only mode with an mmap'ed
 * page cache for fast point lookups.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { foldQuery, kindName } from "./fold.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.resolve(HERE, "..", "..", "data", "dictionary.db");

export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : DEFAULT_DB;

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");
db.pragma("cache_size = -32000"); // ~32 MiB page cache
db.pragma("mmap_size = 268435456"); // ~256 MiB mmap
db.pragma("temp_store = MEMORY");

export interface SuggestResult {
  id: number;
  word: string;
  pos: string;
  gender: string | null;
  article: string | null;
  plural: string | null;
  snippet: string;
  kind: number;
  match: string;
  exactForm: boolean;
}

export interface SuggestOutcome {
  /** The query actually used to obtain the results. */
  effectiveQuery: string;
  /** True when a leading reflexive pronoun ("sich ") was dropped to match. */
  reflexFallback: boolean;
  results: SuggestResult[];
}

interface RawSuggestRow {
  id: number;
  kind: number;
  exact_form: number;
  word: string;
  pos: string;
  gender: string | null;
  article: string | null;
  plural: string | null;
  g0: string | null;
  g1: string | null;
  g2: string | null;
}

const SUGGEST_SQL = `
  SELECT
    e.id                                   AS id,
    MIN(k.kind)                            AS kind,
    MAX(k.exact_form)                      AS exact_form,
    e.word                                 AS word,
    e.pos                                  AS pos,
    e.gender                               AS gender,
    json_extract(e.data, '$.article')      AS article,
    json_extract(e.data, '$.plural')       AS plural,
    json_extract(e.data, '$.senses[0].glosses[0]') AS g0,
    json_extract(e.data, '$.senses[0].glosses[1]') AS g1,
    json_extract(e.data, '$.senses[0].glosses[2]') AS g2
  FROM search_keys k
  JOIN entries e ON e.id = k.entry_id
  WHERE (k.kind = 0 AND k.key = @k0)
     OR (k.kind = 1 AND k.key = @k1)
     OR (k.kind = 2 AND k.key = @k2)
     OR (k.kind = 3 AND k.key = @k3)
  GROUP BY e.id
  ORDER BY kind ASC, exact_form DESC, length(e.word) ASC, e.word ASC
  LIMIT @limit
`;

const suggestStmt = db.prepare<[Record<string, unknown>], RawSuggestRow>(SUGGEST_SQL);
const entryStmt = db.prepare<[number], { data: string }>(
  "SELECT data FROM entries WHERE id = ?",
);
const countStmt = db.prepare<[], { c: number }>("SELECT count(*) AS c FROM entries");
const keysStmt = db.prepare<[], { c: number }>("SELECT count(*) AS c FROM search_keys");

function runSuggest(query: string, limit: number): SuggestResult[] {
  const folded = foldQuery(query);
  const rows = suggestStmt.all({
    k0: folded.exact,
    k1: folded.translit,
    k2: folded.strip,
    // English keys are plain lower-cased words, so the exact (NFC + lowercase) key is used
    k3: folded.exact,
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((row) => {
    const glosses = [row.g0, row.g1, row.g2].filter(
      (g): g is string => typeof g === "string" && g.length > 0,
    );
    return {
      id: row.id,
      word: row.word,
      pos: row.pos,
      gender: row.gender,
      article: row.article,
      plural: row.plural,
      snippet: glosses.length ? `${glosses.join("; ")}${glosses.length === 3 ? " …" : ""}` : "",
      kind: row.kind,
      match: kindName(row.kind),
      exactForm: row.exact_form === 1,
    };
  });
}

export interface AutocompleteItem {
  id: number;
  word: string;
  pos: string;
}

// Prefix suggestions over headword keys, most "important" first. An exact
// match of the typed text always leads; then single words come before
// multi-word phrases/idioms; within each group entries are
// ranked by weight (the size of the entry, a popularity proxy). Matches on
// any of the three folded key kinds, so "madch" and "mädch" both find
// "Mädchen".
const AC_TABLE_SQL = `
  SELECT entry_id AS id, word, pos, MAX(weight) AS weight,
         MAX(key IN (@a0, @a1, @a2)) AS exact
  FROM autocomplete
  WHERE (kind = 0 AND key >= @a0 AND key < @b0)
     OR (kind = 1 AND key >= @a1 AND key < @b1)
     OR (kind = 2 AND key >= @a2 AND key < @b2)
  GROUP BY entry_id
  ORDER BY exact DESC, (instr(word, ' ') > 0) ASC, weight DESC,
           length(word) ASC, word ASC
  LIMIT @limit
`;

// Fallback for databases built before the autocomplete table existed.
const AC_FALLBACK_SQL = `
  SELECT e.id AS id, e.word AS word, e.pos AS pos, length(e.data) AS weight,
         MAX(k.key IN (@a0, @a1, @a2)) AS exact
  FROM search_keys k
  JOIN entries e ON e.id = k.entry_id
  WHERE k.exact_form = 1 AND (
        (k.kind = 0 AND k.key >= @a0 AND k.key < @b0)
     OR (k.kind = 1 AND k.key >= @a1 AND k.key < @b1)
     OR (k.kind = 2 AND k.key >= @a2 AND k.key < @b2))
  GROUP BY e.id
  ORDER BY exact DESC, (instr(e.word, ' ') > 0) ASC, weight DESC,
           length(e.word) ASC, e.word ASC
  LIMIT @limit
`;

const hasAutocompleteTable =
  db
    .prepare<[], { n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'autocomplete'",
    )
    .get()!.n > 0;

const autocompleteStmt = db.prepare<
  [Record<string, unknown>],
  { id: number; word: string; pos: string; weight: number }
>(hasAutocompleteTable ? AC_TABLE_SQL : AC_FALLBACK_SQL);

export function autocomplete(query: string, limit = 8): AutocompleteItem[] {
  // "sich ver..." -> complete the part after the reflexive pronoun.
  const trimmed = query.trim().replace(/^sich\s+/i, "");
  if (!trimmed) return [];
  const folded = foldQuery(trimmed);
  const max = Math.min(Math.max(limit, 1), 15);
  const bounds = {
    a0: folded.exact,
    b0: folded.exact + "\uffff",
    a1: folded.translit,
    b1: folded.translit + "\uffff",
    a2: folded.strip,
    b2: folded.strip + "\uffff",
  };
  // Over-fetch: homographs (Haus noun / Haus name) collapse into one word.
  const rows = autocompleteStmt.all({ ...bounds, limit: max * 4 });
  const seen = new Set<string>();
  const out: AutocompleteItem[] = [];
  for (const row of rows) {
    if (seen.has(row.word)) continue;
    seen.add(row.word);
    out.push({ id: row.id, word: row.word, pos: row.pos });
    if (out.length >= max) break;
  }
  return out;
}

/** "sich verlieben" -> "verlieben"; null when there is no reflexive prefix. */
const REFLEXIVE_RE = /^sich\s+(.+)$/i;

export function suggest(query: string, limit = 25): SuggestOutcome {
  const trimmed = query.trim();
  const direct = runSuggest(trimmed, limit);
  if (direct.length > 0) {
    return { effectiveQuery: trimmed, reflexFallback: false, results: direct };
  }

  // The source lemmatises reflexive verbs without the pronoun ("verlieben"),
  // but users search them the way they are spoken: "sich verlieben". When the
  // full phrase matches nothing, retry with the leading pronoun removed.
  const rest = trimmed.match(REFLEXIVE_RE)?.[1]?.trim();
  if (rest) {
    const fallback = runSuggest(rest, limit);
    if (fallback.length > 0) {
      return { effectiveQuery: rest, reflexFallback: true, results: fallback };
    }
  }

  return { effectiveQuery: trimmed, reflexFallback: false, results: direct };
}

export function getEntry(id: number): Record<string, unknown> | null {
  const row = entryStmt.get(id);
  if (!row) return null;
  const entry = JSON.parse(row.data) as Record<string, unknown>;
  return { id, ...entry };
}

export function stats(): { entries: number; searchKeys: number; dbPath: string } {
  return {
    entries: countStmt.get()!.c,
    searchKeys: keysStmt.get()!.c,
    dbPath: DB_PATH,
  };
}
