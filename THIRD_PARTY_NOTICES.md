# Third-party notices

The source code in this repository is released under the [MIT License](LICENSE).
The dictionary **data** it displays is not covered by that licence: it comes from Wiktionary and
has its own terms, summarised here so you can check them before reusing or redistributing
anything.

> **This is not legal advice.** The information below comes from each project's own
> documentation. Licences can change; always check the original source.

## Dictionary data

| Source | Used for | Licence | Notes |
|---|---|---|---|
| [Wiktionary](https://de.wiktionary.org/) (German edition), extracted by [wiktextract](https://github.com/tatuylonen/wiktextract) and published by [kaikki.org](https://kaikki.org/) | Headwords, inflected forms, senses, examples, IPA and word relations | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and [GFDL](https://www.gnu.org/licenses/fdl-1.3.html) (dual-licensed by Wikimedia) | Attribution is required and derived data must be shared under the same licence. |

> **Pronunciation enrichment.** `ingest/extract_ipa.py` builds a small `(word, pos) → IPA` map from
> the German Wiktionary edition published by kaikki.org ([kaikki.org/dewiktionary/Deutsch](https://kaikki.org/dewiktionary/Deutsch/index.html)).
> The optional `ingest.py --ipa-db` step uses it to fill entries whose main dump has no pronunciation
> (some pages carry only an audio file). This is the same CC BY-SA 4.0 + GFDL Wiktionary content as
> above, so nothing about the terms changes.

What this means for Lexikon:

- **Attribution.** The website credits Wiktionary in its footer and links to the licence.
  Keep that credit if you deploy your own copy.
- **Share-alike.** The `data/dictionary.db` file built by `ingest/ingest.py` is an adaptation
  of the Wiktionary content, so it is distributed under CC BY-SA 4.0, not under the MIT licence
  of the code. Do not publish it under another licence.
- **Not in this repository.** The dump (`data/raw/`) and the built database (`data/*.db`) are
  git-ignored: they are regenerated from the original source, never committed.

## Word frequency data

| Source | Used for | Licence | Notes |
|---|---|---|---|
| [Leipzig Corpora Collection](https://wortschatz.uni-leipzig.de/en/download) (Wortschatz Leipzig: Universität Leipzig, Sächsische Akademie der Wissenschaften zu Leipzig, InfAI), German web corpus, revision 2024.08.31 | How often each word occurs, to rank ambiguous words and to mark common ones | [CC BY](https://creativecommons.org/licenses/by/4.0/) ("the text corpora offered for download", see the project's [Terms of Usage](https://wortschatz.uni-leipzig.de/en/usage)) | Attribution is required and changes must be indicated. |

What this means for Lexikon:

- **Attribution.** Word frequencies come from the Leipzig Corpora Collection (Wortschatz
  Leipzig, Universität Leipzig / SAW Leipzig / InfAI). Keep this credit if you reuse the data.
- **Changes.** The corpus word list is not copied. `ingest/ingest.py` adds up the counts of
  each entry's headword and inflected forms and stores one number per entry in the database.
- **Terms.** The project's terms say its web interface and services are CC BY-NC, but that the
  text corpora offered for **download** are CC BY. Lexikon only uses a downloaded list.
- **Not in this repository.** The word list is never committed; it is read from `data/raw/`
  when the database is built.

## Audio recordings

Pronunciation clips are **not copied** into this repository or its database; only their URLs are
stored. The browser loads them directly from
[Wikimedia Commons](https://commons.wikimedia.org/), where each file has its own licence (mostly
CC BY-SA, CC BY or public domain) and author credit on its file page.

Some recordings come from [Lingua Libre](https://lingualibre.org) volunteers. `ingest/extract_audio.py`
reads their names from the Commons API and records the URL of each German clip (usually a `.wav`;
Commons stores no transcode), keyed by the spoken word, so `ingest.py --audio-db` can give a
recording to an entry that has none. Lingua Libre recordings are **CC BY-SA 4.0**; the speaker and
the licence stay on the file page, which the site links to for credit.

## Icon

The red book with an Eszett (`web/public/favicon.svg` and the files made from it) was drawn for this
project. The outline of the letter *ß* is taken from DejaVu Sans Bold, which is free to use, modify
and redistribute under the [DejaVu fonts licence](https://dejavu-fonts.github.io/License.html)
(Bitstream Vera licence plus public-domain changes); only the outline is used, not the font.

## Libraries

| Library | Licence |
|---|---|
| [Hono](https://hono.dev/), [@hono/node-server](https://github.com/honojs/node-server) | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT |
| [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) | MIT |
| [tsx](https://github.com/privatenumber/tsx), [TypeScript](https://www.typescriptlang.org/) | MIT, Apache-2.0 |
| [tqdm](https://github.com/tqdm/tqdm) (optional, ingest progress bar) | MPL-2.0 / MIT |

The exact versions are pinned in `server/package-lock.json` and `web/package-lock.json`; the
licence of every transitive dependency is in its own package.
