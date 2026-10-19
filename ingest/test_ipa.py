"""Pronunciation-enrichment tests (extract_ipa.py + ingest.load_ipa_map / --ipa-db).

``ingest.py`` reads the kaikki.org *en.wiktionary* German dump, whose Pronunciation
section sometimes omits an IPA the German Wiktionary has (e.g. "schleißen", which
only carries audio on en.wiktionary). ``extract_ipa.py`` turns the sister
de.wiktionary dump into a compact ``(word, pos) -> [ipa, ...]`` map; the ingest
fills entries that arrived without a pronunciation, never overriding existing ones.

Run from the repository root:  python -m unittest discover -s ingest -p "test_*.py"
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import extract_ipa
import ingest


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _sounds_of(db: Path, word: str, pos: str) -> list[dict]:
    conn = sqlite3.connect(db)
    try:
        row = conn.execute(
            "SELECT data FROM entries WHERE word = ? AND pos = ? LIMIT 1", (word, pos)
        ).fetchone()
    finally:
        conn.close()
    assert row is not None, f"no entry for {word!r}/{pos!r}"
    return json.loads(row[0]).get("sounds") or []


class ShouldSkipTests(unittest.TestCase):
    def test_single_characters_and_short_forms_are_skipped(self) -> None:
        for word, pos in [
            ("f", "character"),
            ("o", "character"),
            ("A", "character"),
            ("is", "verb"),
            ("in", "prep"),
            ("o", "intj"),
        ]:
            with self.subTest(word=word, pos=pos):
                self.assertTrue(extract_ipa.should_skip(word, pos))

    def test_real_words_are_kept(self) -> None:
        for word, pos in [
            ("schleißen", "verb"),
            ("Dezember", "noun"),
            ("schließen", "verb"),
        ]:
            with self.subTest(word=word, pos=pos):
                self.assertFalse(extract_ipa.should_skip(word, pos))


class ExtractTests(unittest.TestCase):
    def test_builds_map_and_skips_short_entries(self) -> None:
        de_rows = [
            {
                "word": "schleißen",
                "pos": "verb",
                "lang_code": "de",
                "sounds": [
                    {"ipa": "[ˈʃlaɪ̯sn̩]"},
                    {"audio": "De-schleißen.ogg"},
                    {"rhymes": "aɪ̯sn̩"},
                ],
            },
            {
                "word": "f",
                "pos": "character",
                "lang_code": "de",
                "sounds": [{"ipa": "[ɛf]"}],
            },
            {
                "word": "in",
                "pos": "prep",
                "lang_code": "de",
                "sounds": [{"ipa": "[ɪn]"}],
            },
            {"word": "Hallo", "pos": "intj", "lang_code": "de"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "de.jsonl"
            out = Path(tmp) / "ipa_de.db"
            _write_jsonl(dump, de_rows)
            stats = extract_ipa.extract(dump, out)
            ipa_map = ingest.load_ipa_map(out)

            self.assertEqual(stats["rows"], 1)
            self.assertEqual(ipa_map, {("schleißen", "verb"): ["[ˈʃlaɪ̯sn̩]"]})
            self.assertNotIn(("f", "character"), ipa_map)
            self.assertNotIn(("in", "prep"), ipa_map)

            byword = ingest.load_ipa_byword(out)
            self.assertEqual(byword, {"schleißen": ["[ˈʃlaɪ̯sn̩]"]})


    def test_byword_excludes_ambiguous_words(self) -> None:
        de_rows = [
            {
                "word": "durchgehend",
                "pos": "adj",
                "lang_code": "de",
                "sounds": [{"ipa": "[dʊʁçˈɡeːənt]"}],
            },
            {
                "word": "durchgehend",
                "pos": "adv",
                "lang_code": "de",
                "sounds": [{"ipa": "[dʊʁçˌɡeːənt]"}],
            },
            {
                "word": "Einbahnstraße",
                "pos": "noun",
                "lang_code": "de",
                "sounds": [{"ipa": "[ˈaɪ̯nbɑːnˌʃtʁaːsə]"}],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "de.jsonl"
            out = Path(tmp) / "ipa_de.db"
            _write_jsonl(dump, de_rows)
            extract_ipa.extract(dump, out)
            byword = ingest.load_ipa_byword(out)

            self.assertNotIn("durchgehend", byword)
            self.assertEqual(byword, {"Einbahnstraße": ["[ˈaɪ̯nbɑːnˌʃtʁaːsə]"]})


class PlaceholderTests(unittest.TestCase):
    def test_loaders_drop_placeholder_ipa(self) -> None:
        # de.wiktionary marks a word with no known pronunciation as "[…]"; it must
        # not be attached as if it were a transcription.
        de_rows = [
            {"word": "FSK", "pos": "noun", "lang_code": "de", "sounds": [{"ipa": "[…]"}]},
            {
                "word": "Dezember",
                "pos": "noun",
                "lang_code": "de",
                "sounds": [{"ipa": "[deˈtsɛmbɐ]"}],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "de.jsonl"
            out = Path(tmp) / "ipa_de.db"
            _write_jsonl(dump, de_rows)
            # extract_ipa keeps the raw value; the loaders are the gate.
            extract_ipa.extract(dump, out)

            ipa_map = ingest.load_ipa_map(out)
            self.assertNotIn(("FSK", "noun"), ipa_map)
            self.assertEqual(ipa_map, {("Dezember", "noun"): ["[deˈtsɛmbɐ]"]})

            byword = ingest.load_ipa_byword(out)
            self.assertNotIn("FSK", byword)
            self.assertEqual(byword, {"Dezember": ["[deˈtsɛmbɐ]"]})

    def test_fill_never_pastes_a_placeholder(self) -> None:
        de_rows = [{"word": "FSK", "pos": "noun", "lang_code": "de", "sounds": [{"ipa": "[…]"}]}]
        en_rows = [
            {
                "word": "FSK",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["FSK"]}],
                "sounds": [{"audio": "De-FSK.ogg"}],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            de_dump = Path(tmp) / "de.jsonl"
            en_dump = Path(tmp) / "en.jsonl"
            ipa_db = Path(tmp) / "ipa_de.db"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(de_dump, de_rows)
            _write_jsonl(en_dump, en_rows)
            extract_ipa.extract(de_dump, ipa_db)
            stats = ingest.run(en_dump, out, 100, ipa_byword=ingest.load_ipa_byword(ipa_db))

            self.assertEqual(stats["ipa_filled"], 0)
            self.assertEqual(_sounds_of(out, "FSK", "noun"), [])


class IngestFillTests(unittest.TestCase):
    def test_fills_missing_ipa_and_keeps_existing(self) -> None:
        en_rows = [
            {
                "word": "schleißen",
                "pos": "verb",
                "lang_code": "de",
                "senses": [{"glosses": ["to tear, to split, to peel"]}],
                "sounds": [{"audio": "De-schleißen.ogg", "tags": ["Germany"]}],
            },
            {
                "word": "schließen",
                "pos": "verb",
                "lang_code": "de",
                "senses": [{"glosses": ["to close"]}],
                "sounds": [{"ipa": "/ˈʃliːsn̩/"}],
            },
        ]
        ipa_map = {
            ("schleißen", "verb"): ["[ˈʃlaɪ̯sn̩]"],
            ("schließen", "verb"): ["[ˈother]"],
        }
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100, ipa_map=ipa_map)

            self.assertEqual(stats["ipa_filled"], 1)
            self.assertEqual(
                _sounds_of(out, "schleißen", "verb"), [{"ipa": "[ˈʃlaɪ̯sn̩]"}]
            )
            self.assertEqual(_sounds_of(out, "schließen", "verb"), [{"ipa": "/ˈʃliːsn̩/"}])

    def test_word_only_fallback_fills_unambiguous(self) -> None:
        en_rows = [
            {
                "word": "Eiffelturm",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["Eiffel Tower"]}],
                "sounds": [{"audio": "De-Eiffelturm.ogg"}],
            },
        ]
        ipa_byword = {"Eiffelturm": ["[ˈaɪ̯fl̩ˌtʊʁm]"]}
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100, ipa_byword=ipa_byword)

            self.assertEqual(stats["ipa_filled"], 1)
            self.assertEqual(
                _sounds_of(out, "Eiffelturm", "noun"),
                [{"ipa": "[ˈaɪ̯fl̩ˌtʊʁm]"}],
            )

    def test_word_only_fallback_skips_ambiguous(self) -> None:
        en_rows = [
            {
                "word": "durchgehend",
                "pos": "adj",
                "lang_code": "de",
                "senses": [{"glosses": ["continuous"]}],
                "sounds": [{"audio": "De-durchgehend.ogg"}],
            },
        ]
        # multi-IPA in ipa_de: excluded from word-only map by load_ipa_byword
        ipa_byword: dict[str, list[str]] = {}
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100, ipa_byword=ipa_byword)

            self.assertEqual(stats["ipa_filled"], 0)
            self.assertEqual(_sounds_of(out, "durchgehend", "adj"), [])

    def test_no_map_leaves_sounds_untouched(self) -> None:
        en_rows = [
            {
                "word": "schleißen",
                "pos": "verb",
                "lang_code": "de",
                "senses": [{"glosses": ["to tear, to split, to peel"]}],
                "sounds": [{"audio": "De-schleißen.ogg"}],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100)

            self.assertEqual(stats["ipa_filled"], 0)
            self.assertEqual(_sounds_of(out, "schleißen", "verb"), [])


if __name__ == "__main__":
    unittest.main()
