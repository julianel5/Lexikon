## What

<!-- What does this pull request change? -->

## Why

<!-- The problem it solves. Link the issue: "Fixes #123". -->

## Testing

<!-- How you checked it: commands you ran, words you searched, screenshots for UI changes (desktop and phone). -->

## Checklist

- [ ] The title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`fix(web): ...`), in English.
- [ ] `npx tsc -b`, `npm run lint` and `npm run build` pass in `web/`; `npx tsc --noEmit` and `npm test` pass in `server/`; the ingest tests pass (`python -m unittest discover -s ingest -p "test_*.py"`).
- [ ] If the search-key folding or the English word cutting changed, `ingest/ingest.py` and `server/src/fold.ts` / `english.ts` still match, the shared cases in `ingest/fixtures/` are updated and the database was rebuilt.
- [ ] No hard-coded colours (the light and dark themes keep working).
- [ ] For a visible change: checked at about 390 px wide and in both themes, with the interface text in English.
- [ ] Documentation is updated (README, CONTRIBUTING, and a line under *Unreleased* in CHANGELOG.md), if needed.
- [ ] I have read and understood every line of the change, and I ran the checks above myself.

## AI assistance

<!-- Keep this line last: the description becomes the commit message on main. Name each AI tool and model, one line per assistant (see "AI-assisted contributions" in CONTRIBUTING.md), or write "none". Examples: "Assisted-by: Claude Code:claude-sonnet-5-5", "Assisted-by: none". -->

Assisted-by: 
