# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is
not versioned yet, so everything so far is listed under **Unreleased**.

## [Unreleased]

### Added

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
- Reflexive queries (`sich verlieben`) resolve to the verb's entry.
- Keyboard navigation of the search results.

### Changed

- Entry pages are one Jiten-style card: a panel in the page's slate palette with a thin border, titled sections
  (Forms, Meanings, relations), pills for part of speech, articles and sense tags.
- The header has a search (magnifier) button that returns to the search box and focuses it.
- Removed the "Back to search" button (the browser's back button still works) and the tagline.
- Flat visual style: 2 px corner radii, solid background, no gradients or shadows.
- The page title is `Lexikon`.

### Fixed

- Content clipped on narrow screens (the audio button and long related terms went off-screen at
  320 px) and tap targets that were too small.
