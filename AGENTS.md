# AGENTS.md

Instructions for coding agents working in Lexikon. Humans should start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this file does not repeat them, it
records what an agent must not get wrong. Rules marked **(confirmed)** are enforced by code, CI
or documented project policy. Rules marked **(recommended)** are good practice inferred from the
code and can be revisited with the maintainers.

## 1. Project overview

Lexikon is a fast, ad-free **German → English dictionary for learners**, aimed at immersion
(looking words up while reading, listening or watching). It is inspired by
[Jiten](https://jiten.moe) (a Japanese dictionary), but covers German and shares no code or data
with it. Live at <https://lexikon.up.railway.app>. The owner is `julianel5`; contributors work
through pull requests.

Product priorities, in order: correct lemma and form lookup, search speed, readable entries,
no ads or accounts.

Implemented: folded search (umlaut/ß), English → German reverse search, as-you-type
autocomplete, sentence segmentation with lemma resolution and compound splitting
(`POST /api/parse`), entry pages with IPA, audio, grammar tables, relations, light/dark theme,
shareable URLs.
Word frequencies exist in the data and the API (optional `--freq` in the ingest, used to rank text analysis, suggestions and
autocomplete) and shown as a rank label (`#349`) in the UI; there is no filter by frequency yet. Not implemented (listed in the README roadmap, do not assume they exist):
separable-verb recognition, multi-word expressions, English lemmatization, Anki export, example
sentences from other corpora. There is no user system and no write API.

## 2. Repository architecture

```
ingest/    Python (stdlib, optional tqdm): kaikki.org JSONL dump -> SQLite
server/    Node + Hono + better-sqlite3, read-only API over that SQLite file
web/       React 18 + Vite + TypeScript + Tailwind v4 single-page app (static in production)
deploy/    nginx template used by web/Dockerfile
data/      git-ignored build output (data/raw/*, data/*.db)
docs/      README screenshots
```

Data flow: `ingest/ingest.py` → `data/dictionary.db` → `server/src/db.ts` → `server/src/index.ts`
(routes) → `web/src/lib/api.ts` → hooks in `web/src/lib/` → components in `web/src/components/`.

Where things go:

| Change | Location |
|---|---|
| What is stored per entry, how Wiktionary data is extracted, search keys | `ingest/ingest.py` |
| SQL and ranking of search results | `server/src/db.ts` |
| Text segmentation, lemma choice, compound splitting | `server/src/parse.ts` (pure logic; the database is injected as `Lookup`) |
| English word cutting for reverse search | `server/src/english.ts` (mirror of `english_words` in `ingest.py`) |
| Key folding | `server/src/fold.ts` (mirror of `exact_key`/`translit_key`/`strip_key` in `ingest.py`) |
| HTTP routes, validation, CORS | `server/src/index.ts` |
| API response types used by the UI | `web/src/lib/api.ts` (hand-written; update it with the server) |
| Data fetching and state | hooks in `web/src/lib/` (`useSearch`, `useAutocomplete`, `useEntry`, `useSentence`) |
| Theming and design tokens | `web/src/index.css` |

The server opens the database **read-only** (`readonly: true`); it must never write. The web app
only talks to the API through `web/src/lib/api.ts`.

## 3. Development workflow

Requirements (confirmed, CONTRIBUTING.md): Python 3.10+, Node.js 20+ (CI uses Python 3.13, Node
24). On Windows `better-sqlite3` compiles at install and needs the Visual Studio C++ build tools.
Install dependencies with `npm ci`, not `npm install`. A running dev server locks native modules
on Windows: stop it before `npm ci`.

```bash
python ingest/ingest.py ingest/fixtures/sample.jsonl -o data/dictionary.db   # small dev database
cd server && npm ci && npm run dev      # API on :3000 (DB_PATH defaults to ../data/dictionary.db)
cd web && npm ci && npm run dev         # app on :5173 (VITE_API_BASE defaults to :3000)
```

The full dictionary needs the ~1 GB kaikki.org dump (README, "Quick start"). Never commit it or
a built database.

Checks, exactly what CI runs (confirmed, `.github/workflows/ci.yml` and `tests.yml`). Run those
that your change touches, and say which you ran:

```bash
cd web    && npx tsc -b && npm run lint && npm run build
cd server && npx tsc --noEmit && npm test
python -m unittest discover -s ingest -p "test_*.py"
python ingest/ingest.py ingest/fixtures/sample.jsonl -o data/check.db   # must build and verify
```

Before changing code, read the module and its tests. When investigating a bug, reproduce it first
(a failing test, or a request against the local API), fix the cause, and re-run the same
reproduction. A change that merely compiles is not verified; for UI changes look at the page in
a browser at desktop and phone widths, in both themes.

## 4. Coding conventions

- Everything is in **English**: identifiers, comments, commit messages, docs (confirmed).
  Comments explain *why*, not what (confirmed).
- **TypeScript is strict**; the server also uses `noUncheckedIndexedAccess`, so indexed access
  needs handling (use `!` only where an invariant guarantees it, as `fold.ts` does). ESLint
  (typescript-eslint, react-hooks, react-refresh) runs on `web/` only.
- Style follows the surrounding file: the server uses double quotes and semicolons, `web/` uses
  single quotes and no semicolons; Python follows the existing type-hinted, docstring style of
  `ingest.py`. There is no Prettier or Black config: do not reformat files you did not change.
- The server validates input at the route (`index.ts`: numeric ids → 400, unknown id → 404, text
  over `MAX_TEXT_LENGTH` → 413, `limit` clamped in `db.ts`). Keep new endpoints equally strict.
- Reuse before abstracting: this is a small codebase with few abstractions. Add a helper only
  when two real call sites need it.
- Preserve file line endings. `.gitattributes` stores text as LF; on Windows checkouts the
  working copy may be CRLF. Edit in a way that does not turn a one-line change into a whole-file
  diff, and check `git diff --stat`.

## 5. German language and dictionary domain

This replaces any Japanese-specific assumptions: the data is German Wiktionary.

**Integrity rules (confirmed by code and tests):**

- **Folding is defined twice and must stay identical.** `ingest/ingest.py` (`exact_key`,
  `translit_key`, `strip_key`, `english_words`) and `server/src/fold.ts` / `server/src/english.ts`
  build and query the same keys. Shared expected values live in
  `ingest/fixtures/fold_cases.json` and `english_cases.json`, used by both
  `ingest/test_fold.py` and `server/test/fold.test.ts`. If you change folding: change both
  implementations, update the fixtures, and tell the maintainers the database must be rebuilt
  and re-uploaded (a code deploy alone does not change the stored keys).
- Key kinds: 0 exact (NFC + lowercase), 1 translit (ä→ae ö→oe ü→ue ß→ss), 2 strip (ä→a ö→o ü→u
  ß→s), 3 English gloss word. Use `lower()`, never `casefold()`: `ß` must stay `ß`.
- **Do not normalize stored data beyond the existing rules.** Headwords, forms and glosses are
  stored as Wiktionary gives them; only the *search keys* are folded. Never fold, lowercase or
  re-spell what is displayed.
- **Do not invent linguistic data.** Gender, article, plural, auxiliary, `separable`, IPA and
  glosses come from the dump. If a value is missing, leave it `null`/absent rather than
  guessing from the word's ending. Heuristics (lemma ranking, compound splitting) live only in
  `parse.ts` and their results are *candidates*, returned ranked, never a verdict.
- One written form can be several entries (different part of speech, gender or meaning,
  e.g. *Band*). Keep all of them, return them ranked, and never collapse them by `word`.
- Inflected pages (`form_of` in every sense) are not stored as entries; their form becomes a
  search key of the lemma (`exact_form = 0`). Do not turn them into standalone entries.
- German nouns are capitalized and capital letters matter for ranking in `parse.ts`; a sentence's
  first capital carries no information. Keep that logic when touching ranking.
- Compounds: the right-hand part decides the meaning; linking elements (`s`, `n`, `en`, `er`, `e`,
  `es`, `ens`, `ns`) are handled in `decompose`. Splits need parts of at least 3 letters.

**Current behaviour and limits (confirmed, README roadmap):** frequencies are optional (a database built without `--freq`
has `freq = 0` everywhere and the server must keep working and ranking as before), personal pronouns are
still ambiguous (every pronoun lists the same table, so *mir* does not always get *ich* first), no
separable-verb detection, English queries are not lemmatized. Do not describe these as supported.
Other additions are **proposals**: discuss them with the maintainers first.

**Search invariants (confirmed):** German matches (kinds 0–2) always rank before English ones
(kind 3); results are ordered by `kind`, then relevance (see `SUGGEST_SQL` in `db.ts`). Keep
ordering deterministic (recommended): give any new `ORDER BY` an explicit final tiebreak such as
the word or id.

## 6. Data sources and licensing

Confirmed in `THIRD_PARTY_NOTICES.md`:

- Dictionary data: German Wiktionary via [wiktextract](https://github.com/tatuylonen/wiktextract)
  and [kaikki.org](https://kaikki.org), **CC BY-SA 4.0** (and GFDL). The built `dictionary.db` is
  an adaptation and keeps CC BY-SA 4.0; the code is MIT. Attribution to Wiktionary stays in the
  site footer.
- Audio: only Wikimedia Commons **URLs** are stored (`https://upload.wikimedia.org/`); the files
  are never copied into the repo or database.

Rules:

- Do not add a data source (dictionary, corpus, frequency list, audio, API) without first
  checking its origin, licence, format and compatibility with CC BY-SA 4.0 data and MIT code,
  and recording it in `THIRD_PARTY_NOTICES.md`. Frequency lists in particular have conflicting
  or non-commercial terms: **verify before use** (the Leipzig list in use was checked against the
  project's Terms of Usage). If the licence is unclear, say so and stop.
- Do not copy content, data, text, code or assets from Jiten or any other dictionary.
- Never commit `data/raw/*`, `data/*.db`, or other large generated data.

## 7. Search and performance

Implementation (confirmed): SQLite tables `entries`, `search_keys(kind, key, entry_id,
exact_form)` (a `WITHOUT ROWID` table keyed by `(kind, key, entry_id)`) and `autocomplete`
(headwords only, with a `weight` popularity proxy). `suggest` looks up the folded query in kinds
0–3; multi-word English queries are ANDed word by word with a phrase boost; autocomplete is a
prefix lookup. Kind 3 `exact_form` is a relevance score 1–4 (see README, "How search works").

- Queries must use the indexes: keep lookups as `key = ?` or range/prefix on `key`, and avoid
  `LIKE '%…'`, per-row JSON parsing in hot paths where an indexed column works, and unbounded
  result sets (`limit` is clamped; `MAX_TEXT_LENGTH`, `MAX_CANDIDATES`, `MAX_DECOMPOSITIONS`
  bound `/api/parse`).
- Derived tables (`search_keys`, `autocomplete`) are built only by the ingest. Changing what they
  contain means a new database build; do not patch the live file.
- Do not add a search engine, ORM or extra datastore. SQLite plus the current indexes is the
  established architecture (recommended: keep it unless measurements show a real problem).
- Validate ranking changes with real words, not only unit tests. Useful probes: `schön` /
  `schoen` / `schon`, `Fuß` / `fuss`, `Mädchen`, `Häuser` (form → lemma), `die`, `ging`,
  `mir`, `Wasserflasche` (compound), `house`, `hot water`, `dog house`, `water`, and an empty or
  whitespace-only query. Compare before and after, and report regressions.
- The production database is large (~100 k entries, ~4 M keys). Anything that scans `entries` or
  `search_keys` per request is a performance regression.

## 8. Testing and quality assurance

Frameworks (confirmed): `node:test` via `tsx` for the server (`server/test/*.test.ts`:
`fold`, `parse`), `unittest` for the ingest (`ingest/test_fold.py`). There is **no web test
suite**; for the UI, type check, lint, build and check manually.

- Logic in `parse.ts` is tested with an injected fake `Lookup`; follow that pattern so tests need
  no database or network.
- Add or update tests for changes to folding, English word cutting, text analysis, ranking
  helpers and extraction functions in `ingest.py`. Put cases shared by both languages in the
  `ingest/fixtures/*.json` files.
- Cover where relevant: umlauts and `ß` typed three ways, mixed case, NFC vs NFD input,
  hyphenated and apostrophe words (`E-Mail`, `geht's`), empty / whitespace / very long input,
  words with several entries, an inflected form, a compound, and non-German text.
- Do not write tests that call the live site or kaikki.org; use `ingest/fixtures/sample.jsonl`
  or inline data.
- Never state that tests or checks passed unless you ran them, and report failures with their
  output.

## 9. UI and user experience

React 18 function components, hooks in `web/src/lib/`, Tailwind utility classes. Confirmed rules:

- Colours come from the theme tokens in `web/src/index.css` (`--color-card`, `--color-card-edge`,
  `--color-card-edge-strong`, `--radius-card`, and the mirrored light-theme scales). **No
  hard-coded colours**, so both themes keep working (also a PR-template item).
- Style is deliberately flat: few shadows, no gradients, small radii.
- Entry and result cards share one look (`ResultCard`, `EntryView`, `SentenceView` use the same
  tokens); keep new cards consistent with them.
- The UI must work on a phone: check for clipping and horizontal scroll at ~390 px (long German
  compounds need `overflow-wrap`).
- Search box is an accessible combobox (keyboard arrows/Enter/Esc); keep that behaviour. Show
  loading and error states as the existing components do.
- Display words and forms exactly as stored (umlauts, `ß`, capitalization).
- URLs are part of the interface: `/`, `/?q=…`, `/entry/<id>/<word>` (`web/src/lib/route.ts`).

## 10. Dependencies and security

- Prefer existing dependencies; the server has three runtime ones (Hono, `@hono/node-server`,
  `better-sqlite3`), the ingest has none beyond optional `tqdm`. A new dependency needs a
  concrete reason and a licence check (update `THIRD_PARTY_NOTICES.md`).
- Do not edit lockfiles by hand or churn them; change them only through `npm install <pkg>` for a
  deliberate dependency change. Dependabot opens version bumps; do not mass-update.
- The dump and database are untrusted-format inputs: the ingest must tolerate missing or odd
  fields (it caps senses, forms and relations). Do not render stored text as HTML.
- No secrets in the repo or in logs. Production configuration is Railway environment variables
  (`DB_PATH`, `CORS_ORIGIN`, `VITE_API_BASE`).
- Do not run destructive commands (deleting data, volumes or services, `git reset --hard`,
  force-push) without explicit approval. Production operations (uploading a database,
  restarting services) are made by or with the maintainers.
- Security vulnerabilities go through [SECURITY.md](SECURITY.md), not public issues.

## 11. Git and contribution practices

Confirmed (CONTRIBUTING.md, `.github/`):

- Branch from `main`; pull requests are **squash-merged**, so the **PR title** becomes the commit
  on `main` and must follow Conventional Commits (`type(scope): imperative lowercase summary`,
  at most ~70 characters after the colon; types `feat fix docs style refactor perf test build ci
  chore revert`; scopes like `ingest`, `server`, `web`, `deps`). CI rejects other titles.
- Keep commits atomic and each one compiling.
- **AI disclosure:** commits made with an assistant end with `Assisted-by: AGENT:MODEL`
  (for example `Assisted-by: Claude Code:claude-sonnet-5-5`), and the PR description **ends**
  with the same line (CI check `ai disclosure`). Use the PR template sections (What, Why,
  Testing, Checklist, AI assistance).
- Required CI checks: `web`, `server`, `ingest`, `ingest tests`, `server tests`,
  `conventional title`, `ai disclosure`.
- Keep a change focused; send a needed refactor as its own PR. Update README, CONTRIBUTING or
  CHANGELOG when behaviour or setup changes (the CHANGELOG uses "Keep a Changelog" under
  Unreleased).
- Do not touch changes you did not make, and never revert someone else's work. Do not merge a PR
  or push to `main` unless the maintainer asks.

## 12. Agent operating principles

1. Understand the goal and read the relevant code and its tests.
2. Identify the conventions and invariants above that apply (especially folding parity and data
   fidelity).
3. Choose the smallest change that solves the problem.
4. Implement it inside the existing architecture, in the right module.
5. Add or update tests, or state why none apply.
6. Run the checks from section 3 that cover the change.
7. Read your own `git diff`: look for regressions, stray files, line-ending churn, generated
   files and unrelated edits.
8. Report what changed, what you verified (with the commands) and what remains.

Ask before irreversible or production-affecting actions, licence-sensitive choices, and decisions
that need information you cannot find in the repo. Do not ask about details you can determine
from the code.

## Known documentation drift

`CONTRIBUTING.md` ("Project layout") and the PR template still describe an older layout (no
`parse.ts`, `english.ts` or `SentenceView`; the folding test list is incomplete). When in doubt,
trust the code and the CI workflows over those descriptions.
