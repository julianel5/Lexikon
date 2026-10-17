# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) (while it is `0.x`, minor versions may change
behaviour).

## [Unreleased]

### Security

- The web app sends `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy` and `Content-Security-Policy` headers. The CSP only allows
  what the site really loads: its own bundle, the API, the pronunciation clips from Wikimedia and
  the Cloudflare Web Analytics beacon.
  The theme bootstrap therefore moved from an inline script in `index.html` to `public/theme.js`
  (an inline script would be blocked by `script-src 'self'`).

### Added

- A web app manifest and install icons: Lexikon can be installed on a phone or a computer ("Add to
  home screen" / "Install app"). Thanks to Prashant ([@Prashaxt](https://github.com/Prashaxt)), our
  first outside contribution (#63).
- Multi-word forms of separable verbs in the sentence view: *stehe auf* resolves to *aufstehen*, *komme
  mit* to *mitkommen*. It only works when the two parts are next to each other (#64).
- Entries whose pronunciation is missing from the main dump get an IPA from the German Wiktionary:
  a new optional `--ipa-db` step (`ingest/extract_ipa.py`) fills them, so words like *schleißen*
  now show a phonetic transcription (~16,000 entries, #73).
- Sitemaps for search engines: `GET /api/sitemap.xml` is an index over files of up to 50,000 entry
  URLs each (`GET /api/sitemap/page/{n}`), and `robots.txt` references it. The site is a
  single-page app, so the entry pages are listed from the API, which is what has the database.

### Fixed

- Separable verbs no longer join a preposition with its object (*stehe auf dem Tisch*, *kommt mit
  Freunden*, *fährt mit mir* are not *aufstehen*, *mitkommen*, *mitfahren*), and are found again when a comma
  or a full stop follows the particle (*Ich stehe auf, weil…*).
- The web app manifest is served as `application/manifest+json`, not `application/octet-stream`.
- `/api/health` no longer shows the path of the database file.
- `/sitemap.xml` answers 404 instead of the home page (there is no sitemap yet), so search engines
  do not read it as an empty page.

## [0.2.0] - 2026-10-17

Word frequencies, a site of its own and a cleaner interface.

### Added

- Link previews: the page has a description and Open Graph / Twitter metadata with a 1200x630
  image, so a shared link shows a card (Reddit, Discord, Telegram, Slack...).
- "Report a problem with this entry" on every entry opens the *wrong or missing entry* issue form on
  GitHub with the word and the page already filled in; the footer links to the issue chooser.
- The footer credits the Leipzig Corpora Collection (CC BY) next to Wiktionary.
- A real `robots.txt`.
- Word frequencies in the ingest: `--freq` reads a Leipzig Corpora Collection word list and stores,
  per entry, how often its headword and inflected forms occur (`entries.freq`, `entries.freq_rank`,
  and `autocomplete.freq`). It is optional.
- The frequency rank of a word (`#349`, 1 = most frequent) is shown on entry pages and search results.
- The API uses the frequencies when the database has them: `/api/parse` ranks the candidate entries
  of a word by how common they are (so *Danach* is *danach* and not a form of *nach*, and *meinen*
  in *meinen Freunden* is the possessive), `/api/suggest` and `/api/autocomplete` put common words
  first (*Wasser* before *wasserundurchlässig*), `/api/entry/:id` returns `frequency` and
  `/api/suggest` results return `freqRank`. `/api/health` reports `frequencyEntries`. A database
  without frequencies keeps working and ranking as before.
- A site icon: a red book with an Eszett on the cover (SVG favicon, `favicon.ico` and an iOS icon).
- `deploy/deploy-db.sh`: one command to ship a rebuilt database to Railway (back up, upload, check,
  swap, restart, verify).
- `AGENTS.md` and `CLAUDE.md`: instructions for coding agents working on the project.

### Changed

- The footer is simpler: the credits have the same size as the data credits, and the GitHub and Ko-fi
  links are plain icons on the right, without boxes.
- The red book icon is next to the name in the header, the authors in the footer link to their GitHub
  profiles, and the footer thanks Sirush, the creator of Jiten, which inspired Lexikon.
- The whole interface is in English: the credits line ("Site made by") and the verb tense headings
  (*Present*, *Preterite*, *Subjunctive* instead of *Präsens*, *Preterite/Präteritum*,
  *Subjunctive/Konjunktiv*).
- English searches put the standard word first: a match whose first sense is marked as archaic,
  regional, slang, humorous, childish or derogatory counts one step lower (*cat* gives *Katze* before
  the archaic *Bönhase*, *goodbye* gives *auf Wiedersehen* before the slang *bleib stabil*).
- Interjections ("Hallo", "Hi", "Prost") count their capitalised spelling in the word frequencies
  without the usual limit, since they almost always open a sentence (*hallo* is now #1,904, not #12,484).
- The site moved to its own domain: <https://lexikon.moe>, with the API at `api.lexikon.moe`,
  behind Cloudflare (caching of read-only API responses, a per-IP rate limit, `www` redirect).
  The old Railway URL of the web app redirects; the API one keeps working.
- The search suggestions no longer cover the results: they are a list in the page, under the search
  box, that pushes the results down. They stay while you type (and do not close when the box loses
  the focus), and go away with Esc or when you pick one. A page opened with a search already in it
  (a link, a reload) starts without the list.

### Fixed

- The "Show full grammar" tables looked like dark grey boxes in the light theme: they use the theme's
  card colours now, like the rest of the interface.

## [0.1.0] - 2026-10-16

First public version.

### Added

- Word breakdown: entries of compound words show the parts they are made of (taken from
  Wiktionary), each linking to its own entry.
- Complete grammar tables on entry pages (declension of nouns, conjugation of verbs), behind a
  "Show full grammar" button.
- Sentences in the search box: type or paste German text and, on the same page, it is cut into
  words (known ones underlined) with the card of the selected word right below, like Jiten's text
  parsing. Every word is resolved to its dictionary form (*ging* → gehen, *Häusern* → Haus),
  unknown words are marked and compounds are split (*Wasserflaschendeckel* → Wasserflasche +
  Deckel). Words with several possible entries get a tab per entry. Phrases of the dictionary
  and English searches (`hot water`) stay normal searches. Backed by `POST /api/parse`.
- Reverse search with several English words: `hot water`, `good morning`, `thank you`,
  `washing machine`. The query is cut into content words like the glosses were (`to go` is just
  `go`), and an entry must contain all of them; entries whose translation contains the whole
  phrase come first. `dog house` also finds glosses that write it as one word (*doghouse*).
- Reverse search (English → German): typing `house`, `water` or `go` finds *Haus*, *Wasser*
  and *gehen*. The ingest indexes the content words of every gloss as `kind 3` search keys,
  skipping qualifiers, stopwords and glosses that only describe the word ("alternative spelling
  of …"); results found this way show an `ENG` badge. German matches always rank first.
- As-you-type suggestions in the search box, backed by `GET /api/autocomplete` and a ranked
  `autocomplete` table built by the ingest (keyboard navigation, accessible combobox).
- Native-speaker pronunciation: recordings from Wikimedia Commons are played through a
  loudness normaliser; text-to-speech is only used if a German voice is installed.
- Shareable URLs: `/entry/<id>/<word>` for entries and `/?q=<text>` for searches, with back and
  forward support; a stale id is re-resolved by the word in the URL.
- Header with a link home and a light/dark theme switch (remembers the choice and follows the
  system preference), and a footer with the GitHub repository, Ko-fi and credits.
- `Dockerfile`s for the server and the web app, used for the Railway deployment.
- Project documentation: README, contributing guide, code of conduct, security policy, issue and
  pull request templates, CI, Dependabot and `AGENTS.md` for coding agents.
- Reflexive queries (`sich verlieben`) resolve to the verb's entry.
- Keyboard navigation of the search results.

### Changed

- Entry pages are one Jiten-style card: a panel in the page's slate palette with a thin border, titled sections
  (Forms, Meanings, relations), pills for part of speech, articles and sense tags.
- Search result cards use the same card as the entry page (colours, thin border, 6 px radius,
  16 px padding) and the same pills.
- The header has a search (magnifier) button that returns to the search box and focuses it.
- Removed the "Back to search" button (the browser's back button still works) and the tagline.
- Flat visual style: 2 px corner radii, solid background, no gradients or shadows.
- The page title is `Lexikon`.

### Fixed

- Content clipped on narrow screens (the audio button and long related terms went off-screen at
  320 px) and tap targets that were too small.

[Unreleased]: https://github.com/julianel5/Lexikon/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/julianel5/Lexikon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/julianel5/Lexikon/releases/tag/v0.1.0
