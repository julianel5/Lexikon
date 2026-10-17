#!/usr/bin/env python3
"""
Pronunciation enrichment - pre-extract IPA from the kaikki.org de.wiktionary dump.

The main ingest (``ingest.py``) streams a kaikki.org *en.wiktionary* German dump.
That is the right source for English glosses and translations, but its
``Pronunciation`` section sometimes omits an IPA transcription that the German
Wiktionary does carry (for example ``schleißen``, which only has an audio file on
en.wiktionary). This script reads the sister *de.wiktionary* dump and writes a
compact ``(word, pos) -> [ipa, ...]`` map to a small SQLite file, which
``ingest.py`` can load with ``--ipa-db`` to fill entries that arrived without a
pronunciation.

Only ``sounds[].ipa`` is extracted. Audio URLs are ignored: the de dump hosts
them under ``commons.wikimedia.org``, a host the ingest's audio filter does not
accept, and the en dump already supplies audio for those entries.

Usage:
    python extract_ipa.py data/raw/kaikki.org-dictionary-Deutsch.jsonl -o data/ipa_de.db
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

DEFAULT_BATCH = 20_000

# A map row is only trusted when it is unambiguous enough to attach to a
# headword: single characters and very short forms ("f", "o", "is", "in") are
# usually letter names, particles or homographs whose pronunciation is not the
# one a learner expects for the entry being filled.
MIN_WORD_LEN = 3
SKIP_POS = frozenset({"character"})

SCHEMA = """
CREATE TABLE IF NOT EXISTS ipa (
    word TEXT NOT NULL,
    pos  TEXT NOT NULL,
    ipa  TEXT NOT NULL,
    PRIMARY KEY (word, pos, ipa)
) WITHOUT ROWID;
"""


def should_skip(word: str, pos: str) -> bool:
    return pos in SKIP_POS or len(word) < MIN_WORD_LEN


def _ipas_of(entry: dict) -> list[str]:
    ipas = []
    for sound in entry.get("sounds") or []:
        if not isinstance(sound, dict):
            continue
        ipa = sound.get("ipa")
        if isinstance(ipa, str) and ipa:
            ipas.append(ipa)
    return ipas


def extract(input_path: Path, output_path: Path) -> dict:
    stats = {
        "lines": 0,
        "skipped_lang": 0,
        "with_ipa": 0,
        "skipped_short": 0,
        "rows": 0,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(output_path)
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.executescript(SCHEMA)
        batch: list[tuple[str, str, str]] = []

        def flush() -> None:
            if batch:
                conn.executemany("INSERT OR IGNORE INTO ipa VALUES (?, ?, ?)", batch)
                batch.clear()

        with input_path.open("rb") as fh:
            for raw in fh:
                if not raw.strip():
                    continue
                stats["lines"] += 1
                try:
                    entry = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(entry, dict) or entry.get("lang_code") != "de":
                    stats["skipped_lang"] += 1
                    continue
                word = entry.get("word")
                pos = entry.get("pos")
                if not word or not pos:
                    continue
                ipas = _ipas_of(entry)
                if not ipas:
                    continue
                stats["with_ipa"] += 1
                if should_skip(word, pos):
                    stats["skipped_short"] += 1
                    continue
                batch.extend((word, pos, ipa) for ipa in ipas)
                if len(batch) >= DEFAULT_BATCH:
                    flush()
        flush()
        stats["rows"] = conn.execute("SELECT COUNT(*) FROM ipa").fetchone()[0]
    finally:
        conn.commit()
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass

    parser = argparse.ArgumentParser(
        description="Pre-extract (word, pos) -> IPA from a kaikki.org de.wiktionary "
        "JSONL dump into a compact SQLite map for ingest.py --ipa-db."
    )
    parser.add_argument(
        "input", type=Path, help="path to kaikki.org-dictionary-Deutsch.jsonl"
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/ipa_de.db"),
        help="output SQLite path (default: data/ipa_de.db)",
    )
    args = parser.parse_args(argv)

    if not args.input.is_file():
        parser.error(f"input file not found: {args.input}")

    print(f"Reading  {args.input}")
    print(f"Writing  {args.output}")
    stats = extract(args.input, args.output)
    print(
        f"\nDone\n"
        f"  lines        : {stats['lines']:,}\n"
        f"  with ipa     : {stats['with_ipa']:,}\n"
        f"  skipped short: {stats['skipped_short']:,}\n"
        f"  map keys     : {stats['rows']:,}\n"
        f"  output       : {args.output}"
    )


if __name__ == "__main__":
    main()
