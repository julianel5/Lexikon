"""Compound-component extraction tests.

``_extract_components`` reads Wiktionary ``etymology_templates`` from the kaikki dump.
German Wiktionary spells the same idea with long names (``compound``/``affix``/
``suffix``/``prefix``) and short aliases (``com``/``com+``/``af``/``suf``), and some
constituents arrive wrapped in gloss markup (``Schraube<t:screw>``). These tests pin
both the aliases and the markup cleanup.

Run from the repository root:  python -m unittest discover -s ingest -p "test_*.py"
"""

from __future__ import annotations

import unittest

import ingest


def _entry(*templates: dict) -> dict:
    return {"word": "x", "etymology_templates": list(templates)}


class ComponentTests(unittest.TestCase):
    def test_compound_template(self) -> None:
        entry = _entry({"name": "compound", "args": {"2": "Wasser", "3": "Flasche"}})
        self.assertEqual(ingest._extract_components(entry), ["Wasser", "Flasche"])

    def test_affix_alias_af_keeps_linking_element(self) -> None:
        entry = _entry({"name": "af", "args": {"2": "Liebling", "3": "-s-", "4": "Buch"}})
        self.assertEqual(ingest._extract_components(entry), ["Liebling", "-s-", "Buch"])

    def test_compound_alias_com(self) -> None:
        entry = _entry({"name": "com", "args": {"2": "neun", "3": "zehn"}})
        self.assertEqual(ingest._extract_components(entry), ["neun", "zehn"])

    def test_suffix_alias_suf(self) -> None:
        entry = _entry({"name": "suf", "args": {"2": "Zahl", "3": "-en"}})
        self.assertEqual(ingest._extract_components(entry), ["Zahl", "-en"])

    def test_gloss_markup_is_stripped(self) -> None:
        entry = _entry({"name": "com+", "args": {"2": "Schraube<t:screw>", "3": "-er"}})
        self.assertEqual(ingest._extract_components(entry), ["Schraube", "-er"])

    def test_duplicates_are_collapsed(self) -> None:
        entry = _entry({"name": "compound", "args": {"2": "Haus", "3": "Haus"}})
        self.assertEqual(ingest._extract_components(entry), ["Haus"])

    def test_unrelated_templates_are_ignored(self) -> None:
        # Inheritance/derivation templates also carry numbered args, but they are not
        # compound constituents and must not leak into the breakdown.
        entry = _entry({"name": "inh", "args": {"2": "ang", "3": "word"}})
        self.assertEqual(ingest._extract_components(entry), [])

    def test_expansion_fallback(self) -> None:
        entry = _entry({"name": "compound", "expansion": "Arbeit + -s- + Zimmer"})
        self.assertEqual(ingest._extract_components(entry), ["Arbeit", "Zimmer"])


if __name__ == "__main__":
    unittest.main()
