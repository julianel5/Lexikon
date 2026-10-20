# Contributing to Lexikon

Thanks for your interest in Lexikon! This guide explains how to report problems, set up a
development environment and send changes. By taking part you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a wrong or missing entry.** Lexikon shows what Wiktionary says, so content errors are
  best fixed there. If the entry is right on Wiktionary but wrong in Lexikon (a missing form, a
  bad lemma, a wrong article or plural, a search that does not find it), open a
  [Wrong or missing entry](https://github.com/julianel5/Lexikon/issues/new?template=wrong_entry.yml)
  issue with the word, what Lexikon shows and what you expected.
- **Report a bug** (the page breaks, the API errors, audio does not play) with the
  [Bug report](https://github.com/julianel5/Lexikon/issues/new?template=bug_report.yml) form.
- **Suggest a feature** with the
  [Feature request](https://github.com/julianel5/Lexikon/issues/new?template=feature_request.yml) form.
- **Send a pull request.** For anything bigger than a small fix, open an issue first so we can
  agree on the approach before you spend time on it. Issues labelled
  [`good first issue`](https://github.com/julianel5/Lexikon/labels/good%20first%20issue) are a
  good place to start, and
  [`help wanted`](https://github.com/julianel5/Lexikon/labels/help%20wanted) ones are open to
  anyone. For an idea you are not sure about, start a
  [discussion](https://github.com/julianel5/Lexikon/discussions).

Security problems should not be reported in public issues: see [SECURITY.md](SECURITY.md).

## Development environment

You need Python 3.10+ and Node.js 20+ (the project is built with Python 3.13 and Node 24).

```bash
# 1. A small database to develop with (a few seconds)
python ingest/ingest.py ingest/fixtures/sample.jsonl -o data/dictionary.db

# 2. The API on http://localhost:3000
cd server
npm ci
npm run dev

# 3. The web app on http://localhost:5173 (another terminal)
cd web
npm ci
npm run dev
```

To work with the full dictionary, download the kaikki.org dump and build the database as
described in the [README](README.md#quick-start). On Windows, `better-sqlite3` is compiled when
you install the server: it needs the "Desktop development with C++" workload of the Visual
Studio Build Tools (or use WSL). A running dev server locks the native module on Windows: stop it
before running `npm ci` again.

## Checks

These are the checks CI runs (see `.github/workflows/`). Run them before opening a pull
request:

```bash
# web
cd web
npx tsc -b          # type check
npm run lint        # eslint
npm run build       # production build

# server
cd server
npx tsc --noEmit    # type check
npm test            # unit tests (node:test via tsx)

# ingest
python -m unittest discover -s ingest -p "test_*.py"
python ingest/ingest.py ingest/fixtures/sample.jsonl -o data/check.db   # must build and verify
```

The tests cover:

- the search-key folding and the English word cutting, which must give the same result in Python
  and TypeScript (`ingest/fixtures/fold_cases.json` and `english_cases.json` hold the shared
  expected values, read by both `ingest/test_fold.py` and `server/test/fold.test.ts`);
- the text analysis of `POST /api/parse` (lemma choice, compounds, separable verbs) in
  `server/test/parse.test.ts`, with a fake dictionary, so no database is needed;
- the extraction of Wiktionary data and the word frequencies in the ingest
  (`ingest/test_components.py`, `ingest/test_frequency.py`).

There is no automated test for the web app yet: check the page by hand, at desktop and phone
widths and in both themes. If you change the folding, update the cases and both implementations,
then rebuild the database. When you fix a bug, add a test if it can be reproduced without the full
dictionary, and say in the description how you reproduced and checked it.

## Code style

Everything is written in English: identifiers, comments, commit messages and documentation.
Comments explain *why* the code does something, not what it does.

- **TypeScript** is strict; `web/` is linted with ESLint (`npm run lint`).
- **Search-key folding must match in two places.** `ingest/ingest.py` (`exact_key`,
  `translit_key`, `strip_key`) and `server/src/fold.ts` build and query the same keys. If you
  change one, change the other and rebuild the database. The same goes for the English word cutting
  (`english_words` in `ingest.py` and `server/src/english.ts`).
- **UI styling** uses Tailwind utility classes with the theme tokens defined in
  `web/src/index.css`; avoid hard-coded colours so the light and dark themes keep working.
- **The interface text is in English** (labels, headings, buttons); only the dictionary content
  (headwords, forms, examples) is German. Check new screens at about 390 px wide.

## Project layout

```
ingest/              Python pipeline: kaikki.org JSONL dump -> SQLite
  ingest.py
  test_*.py          unit tests (folding, components, frequencies)
  fixtures/          small dump, and cases shared with the server tests
server/              Hono API over a read-only SQLite file
  src/index.ts       routes (/api/suggest, /api/autocomplete, /api/entry/:id, /api/health, POST /api/parse)
  src/db.ts          queries
  src/fold.ts        search-key folding (mirror of ingest.py)
  src/english.ts     English word cutting for reverse search (mirror of ingest.py)
  src/parse.ts       sentence analysis: words, lemmas, compounds, separable verbs
  test/              node:test unit tests
web/                 React + Vite + Tailwind single-page app
  public/            icons, web app manifest, robots.txt, social preview image
  src/components/    Search, SearchBar, ResultCard, SentenceView, EntryView, MorphologyTable...
  src/lib/           API client, hooks (search, autocomplete, entry, sentence), routing, theme
deploy/              nginx config used by web/Dockerfile, and deploy-db.sh to ship a new database
docs/                screenshots used by the README
data/                build output (git-ignored): raw dump and dictionary.db
CHANGELOG.md         what changed in each release
```

## Updating the production database

The site serves one SQLite file from a Railway volume; a change to the ingest or to the data only
reaches <https://lexikon.moe> after that file is rebuilt (or patched) and uploaded. This is a
maintainer task: it touches production, so do it with the owner.

### Adding new audio

Recordings live on Wikimedia Commons, so a new batch only needs two commands and a deploy; the dump
is never re-read and frequencies, search keys and IPA are left untouched.

The recordings must follow the Lingua Libre name,
`LL-Q188 (deu)-<speaker>-<word>.wav`, where `<speaker>` is the exact Wikimedia user name (this is
the `--speaker` value below).

```bash
# 1. Refresh the map from the Commons API. The same -o file accumulates speakers, so this
#    keeps the recordings already collected and adds the new ones (never removes any).
python ingest/extract_audio.py --speaker <speaker> -o data/audio_commons.db \
  --merge-into data/dictionary.db

# 2. Check the new clips before deploying (stop the API first: it holds the file open).
#    It prints how many entries carry a Commons recording; it should have grown.
python ingest/extract_audio.py --speaker <speaker> -o data/audio_commons.db  # prints "recordings"

# 3. Ship the patched database.
gzip -k -f data/dictionary.db
bash deploy/deploy-db.sh

# 4. Purge Cloudflare's cache (dashboard: lexikon.moe > Caching > Configuration >
#    Purge Everything), or visitors keep seeing answers cached from the old database
#    for up to two hours.
```

`deploy-db.sh` backs up the live database, uploads the compressed file, checks its integrity on the
server, swaps it in, restarts the API and verifies the data is served. `--merge-into` writes only
the `data` JSON of the entries that gain a clip; if instead the whole dump is being refreshed, build
from scratch with `--freq --ipa-db --audio-db` (see the [README](README.md#quick-start)) and then
run steps 3 and 4.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <description>

<optional body: what changed and why>

<optional footers, e.g. BREAKING CHANGE: ...>
```

- **Types:** `feat` (new feature), `fix` (bug fix), `docs`, `style` (formatting or visual style
  only), `refactor`, `perf`, `test`, `build` (dependencies, packaging, Docker), `ci`, `chore`,
  `revert`.
- **Scopes** are optional and short, usually the area of the code: `ingest`, `server`, `web`,
  `deps`.
- Write the description in the imperative mood ("add", not "added"), in lowercase, without a
  final period.
- Mark breaking changes with `!` after the type and a `BREAKING CHANGE:` footer that explains
  what users need to change.
- Keep commits **atomic**: one logical change per commit.

Examples from this repository:

```
feat(server): add /api/autocomplete prefix endpoint
fix(web): stop headword, audio button and related terms clipping on narrow screens
style(web): drop shadows, blur and gradients from components
```

## AI-assisted contributions

You can use AI tools (Claude Code, Codex, Copilot, Cursor…), but say so, as the
[Linux kernel](https://docs.kernel.org/process/coding-assistants.html) and
[asbplayer](https://github.com/asbplayer/asbplayer/blob/main/CONTRIBUTING.md) ask:

- **Every commit made with an AI assistant ends with a trailer** naming the tool and the model:

  ```
  Assisted-by: AGENT_NAME:MODEL_VERSION
  ```

  For example `Assisted-by: Claude Code:claude-sonnet-5-5`. Write one line per assistant if you
  used more than one. Editors, linters and formatters do not count.
- **The pull request description ends with the same line**, or with `Assisted-by: none` if no AI
  tool was used. Pull requests are squash-merged and their description becomes the commit
  message on `main`, so this is where the line stays in the history. CI checks that it is there.
- **You are responsible for the change**, whoever wrote it: read and understand every line, run
  the checks above yourself, and say in the description what you ran.

Pull requests that were not run, or that are sent in bulk to many projects at once, are closed.

## Pull requests

1. Fork the repository and create a branch from `main` (for example `fix/umlaut-search`).
2. Make your change and run the checks above.
3. Open a pull request. Its **title must follow Conventional Commits**: CI checks it, and the
   pull request is squash-merged, so the title becomes the commit message on `main`.
4. In the description, explain what changes, why, and how you tested it, and end it with the
   `Assisted-by:` line. The template has the sections.
5. CI runs the type checks, the linter, the build and the tests, plus the checks of the title and
   of the `Assisted-by:` line: `web`, `server`, `ingest`, `ingest tests`, `server tests`,
   `conventional title` and `ai disclosure`. If it is your first contribution, a maintainer has
   to approve the run before it starts. A maintainer reviews the change once it is green.
6. If the change alters what users see or how to set the project up, add a line under
   *Unreleased* in [CHANGELOG.md](CHANGELOG.md) (it follows
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).

Keep pull requests small and focused: a bug fix, a feature or a refactor, not all three. If a
change needs a refactor first, send the refactor as its own pull request.

## Licensing

By contributing, you agree that your contributions are released under the
[MIT License](LICENSE), like the rest of the code. The dictionary content is not ours: it comes
from Wiktionary under CC BY-SA 4.0 (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Never
commit the kaikki.org dump or a built database; the `.gitignore` excludes them.
