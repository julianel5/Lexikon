"""Commons-audio enrichment tests (extract_audio.py + ingest.load_audio_map / --audio-db).

The kaikki.org dump only carries the audio en.wiktionary links, so Lingua Libre
recordings on Wikimedia Commons are missing. ``extract_audio.py`` reads the spoken
word from the Commons file name (``LL-Q188 (deu)-<speaker>-<word>.wav``) and writes a
``word -> URL`` map; the ingest gives a recording to entries that arrived without one,
never overriding existing audio and never storing a URL outside upload.wikimedia.org.

The tests use inline data and an injected fetch, so nothing calls Commons.

Run from the repository root:  python -m unittest discover -s ingest -p "test_*.py"
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import extract_audio
import ingest


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _audio_of(db: Path, word: str, pos: str) -> list[dict]:
    conn = sqlite3.connect(db)
    try:
        row = conn.execute(
            "SELECT data FROM entries WHERE word = ? AND pos = ? LIMIT 1", (word, pos)
        ).fetchone()
    finally:
        conn.close()
    assert row is not None, f"no entry for {word!r}/{pos!r}"
    return json.loads(row[0]).get("audio") or []


class ParseFilenameTests(unittest.TestCase):
    def test_reads_word_and_format(self) -> None:
        cases = [
            ("File:LL-Q188 (deu)-NotoriousMonster-Grundgerüst.wav", "Grundgerüst", "wav"),
            ("LL-Q188 (deu)-NotoriousMonster-Nahrungsergänzung.wav", "Nahrungsergänzung", "wav"),
            ("File:LL-Q188 (deu)-NotoriousMonster-Haus.ogg", "Haus", "ogg"),
            ("File:LL-Q188 (deu)-NotoriousMonster-Haus.oga", "Haus", "ogg"),
            ("File:LL-Q188 (deu)-NotoriousMonster-Haus.mp3", "Haus", "mp3"),
            # A word can itself contain a hyphen once the speaker is cut off.
            ("File:LL-Q188 (deu)-NotoriousMonster-E-Mail.wav", "E-Mail", "wav"),
            # Older uploads use the plain language code "de".
            ("File:LL-Q188 (de)-NotoriousMonster-Haus.wav", "Haus", "wav"),
        ]
        for title, word, fmt in cases:
            with self.subTest(title=title):
                self.assertEqual(
                    extract_audio.parse_filename(title, "NotoriousMonster"), (word, fmt)
                )

    def test_rejects_what_is_not_this_speakers_german_recording(self) -> None:
        for title in [
            "File:LL-Q188 (deu)-SomeoneElse-Haus.wav",  # another speaker
            "File:LL-Q188 (eng)-NotoriousMonster-Haus.wav",  # not German
            "File:De-Haus.ogg",  # not a Lingua Libre name
            "File:LL-Q188 (deu)-NotoriousMonster-Haus.flac",  # unplayable format
            "File:LL-Q188 (deu)-NotoriousMonster-.wav",  # no word
            "File:LL-Q188 (deu)-NotoriousMonster-Haus",  # no extension
        ]:
            with self.subTest(title=title):
                self.assertIsNone(
                    extract_audio.parse_filename(title, "NotoriousMonster")
                )


class BuildMapTests(unittest.TestCase):
    def test_keeps_playable_formats_and_earliest_timestamp(self) -> None:
        images = [
            {
                "title": "File:LL-Q188 (deu)-A-Haus.wav",
                "url": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav?utm=1",
                "timestamp": "2024-01-02T00:00:00Z",
            },
            {
                "title": "File:LL-Q188 (deu)-A-Haus.wav",
                "url": "https://upload.wikimedia.org/wikipedia/commons/y/Haus.wav",
                "timestamp": "2024-01-01T00:00:00Z",
            },
            {
                "title": "File:LL-Q188 (deu)-A-Haus.ogg",
                "url": "https://upload.wikimedia.org/wikipedia/commons/z/Haus.ogg",
                "timestamp": "2024-03-01T00:00:00Z",
            },
            {
                "title": "File:LL-Q188 (eng)-A-Cat.wav",
                "url": "https://upload.wikimedia.org/wikipedia/commons/c/Cat.wav",
                "timestamp": "2024-01-01T00:00:00Z",
            },
            {
                "title": "File:De-Other.ogg",
                "url": "https://upload.wikimedia.org/wikipedia/commons/o/Other.ogg",
                "timestamp": "2024-01-01T00:00:00Z",
            },
            {
                "title": "File:LL-Q188 (deu)-A-Fremd.wav",
                "url": "https://evil.example/Fremd.wav",
                "timestamp": "2024-01-01T00:00:00Z",
            },
        ]
        mapping = extract_audio.build_map(images, ["A"])

        self.assertEqual(
            mapping,
            {
                # The query string is trimmed and the earliest upload wins.
                ("Haus", "wav"): "https://upload.wikimedia.org/wikipedia/commons/y/Haus.wav",
                ("Haus", "ogg"): "https://upload.wikimedia.org/wikipedia/commons/z/Haus.ogg",
            },
        )


class ExtractTests(unittest.TestCase):
    def test_writes_a_readable_map_without_network(self) -> None:
        def fetch(speaker: str) -> list[dict]:
            self.assertEqual(speaker, "NotoriousMonster")
            return [
                {
                    "title": "File:LL-Q188 (deu)-NotoriousMonster-Haus.wav",
                    "url": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
                {
                    "title": "File:LL-Q188 (deu)-NotoriousMonster-Haus.jpg",
                    "url": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.jpg",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            ]

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "audio_commons.db"
            stats = extract_audio.extract(["NotoriousMonster"], out, fetch=fetch)
            self.assertEqual(stats["files"], 2)
            self.assertEqual(stats["rows"], 1)
            self.assertEqual(
                ingest.load_audio_map(out),
                {"Haus": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"}},
            )

    def test_loader_drops_urls_outside_wikimedia(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "audio_commons.db"
            conn = sqlite3.connect(out)
            try:
                conn.executescript(extract_audio.SCHEMA)
                conn.execute(
                    "INSERT INTO audio VALUES ('Haus', 'wav', 'https://evil.example/Haus.wav')"
                )
                conn.commit()
            finally:
                conn.close()
            self.assertEqual(ingest.load_audio_map(out), {})


class IngestFillTests(unittest.TestCase):
    def test_fills_missing_audio_and_keeps_existing(self) -> None:
        en_rows = [
            {
                "word": "Haus",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["house"]}],
            },
            {
                "word": "Auto",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["car"]}],
                "sounds": [
                    {
                        "ogg_url": "https://upload.wikimedia.org/wikipedia/commons/a/Auto.ogg",
                        "tags": ["Germany"],
                    }
                ],
            },
        ]
        audio_map = {
            "Haus": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"},
            "Auto": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Auto.wav"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100, audio_map=audio_map)

            self.assertEqual(stats["audio_filled"], 1)
            self.assertEqual(
                _audio_of(out, "Haus", "noun"),
                [{"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"}],
            )
            # An entry that already has a recording keeps it, untouched.
            self.assertEqual(
                _audio_of(out, "Auto", "noun"),
                [
                    {
                        "ogg": "https://upload.wikimedia.org/wikipedia/commons/a/Auto.ogg",
                        "tags": ["Germany"],
                    }
                ],
            )

    def test_no_map_leaves_audio_untouched(self) -> None:
        en_rows = [
            {
                "word": "Haus",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["house"]}],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "en.jsonl"
            out = Path(tmp) / "dictionary.db"
            _write_jsonl(dump, en_rows)
            stats = ingest.run(dump, out, 100)

            self.assertEqual(stats["audio_filled"], 0)
            self.assertEqual(_audio_of(out, "Haus", "noun"), [])


class MergeIntoDictionaryTests(unittest.TestCase):
    def _build(self, tmp: Path, freq: dict[str, int] | None = None) -> Path:
        en_rows = [
            {
                "word": "Haus",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["house"]}],
            },
            {
                "word": "Auto",
                "pos": "noun",
                "lang_code": "de",
                "senses": [{"glosses": ["car"]}],
                "sounds": [
                    {
                        "ogg_url": "https://upload.wikimedia.org/wikipedia/commons/a/Auto.ogg",
                    }
                ],
            },
        ]
        dump = tmp / "en.jsonl"
        out = tmp / "dictionary.db"
        _write_jsonl(dump, en_rows)
        ingest.run(dump, out, 100, frequencies=freq)
        return out

    def test_fills_only_entries_without_audio(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = self._build(Path(tmp))
            mapping = {
                "Haus": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"},
                "Auto": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Auto.wav"},
            }
            updated = extract_audio.merge_into_dictionary(out, mapping)

            self.assertEqual(updated, 1)
            self.assertEqual(
                _audio_of(out, "Haus", "noun"),
                [{"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"}],
            )
            self.assertEqual(
                _audio_of(out, "Auto", "noun"),
                [{"ogg": "https://upload.wikimedia.org/wikipedia/commons/a/Auto.ogg"}],
            )

    def test_does_not_touch_frequencies_or_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = self._build(Path(tmp), freq={"Haus": 1000})

            def snapshot() -> list[tuple]:
                conn = sqlite3.connect(out)
                try:
                    entries = conn.execute(
                        "SELECT id, word, freq, freq_rank FROM entries ORDER BY id"
                    ).fetchall()
                    keys = conn.execute(
                        "SELECT key, kind, entry_id FROM search_keys ORDER BY kind, key"
                    ).fetchall()
                finally:
                    conn.close()
                return entries, keys

            before = snapshot()
            extract_audio.merge_into_dictionary(
                out,
                {"Haus": {"wav": "https://upload.wikimedia.org/wikipedia/commons/x/Haus.wav"}},
            )
            self.assertEqual(snapshot(), before)


if __name__ == "__main__":
    unittest.main()
