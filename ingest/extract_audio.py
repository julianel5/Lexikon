#!/usr/bin/env python3
"""
Pronunciation enrichment - collect Lingua Libre recordings from Wikimedia Commons.

The main ingest (``ingest.py``) streams a kaikki.org *en.wiktionary* German dump.
That dump only carries the audio files en.wiktionary itself links, so words recorded
by volunteers for [Lingua Libre](https://lingualibre.org) and uploaded to Wikimedia
Commons are missing. This script asks the Commons API for the files of one or more
speakers, keeps the German ones, reads the spoken word out of the file name
(``LL-Q188 (deu)-<speaker>-<word>.wav``) and writes a small ``word -> URL`` map that
``ingest.py`` can load with ``--audio-db`` to add a recording to entries the dump
left without one.

Only the Commons URL is written, never the audio itself, and the licence stays on
Commons (Lingua Libre recordings are CC BY-SA 4.0 by default); the site links back
to the file page for credit.

A build already carries the recordings that existed when it was made. To add the
recordings of a new speaker to a finished ``dictionary.db`` without rebuilding it
(and therefore without recomputing frequencies, keys or IPA), pass ``--merge-into``:
only the ``data`` JSON of the entries that gain a clip is rewritten.

Usage:
    python extract_audio.py --speaker NotoriousMonster -o data/audio_commons.db
    python extract_audio.py --speaker SomeoneElse -o data/audio_commons.db \\
        --merge-into data/dictionary.db
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Iterable

API_URL = "https://commons.wikimedia.org/w/api.php"
RECORD_AUDIO_PREFIX = "https://upload.wikimedia.org/"
# Wikimedia asks for a descriptive User-Agent with a way to contact the operator.
USER_AGENT = "Lexikon-ingest/1.0 (https://lexikon.moe; https://github.com/julianel5/Lexikon)"

# Lingua Libre names a file "LL-<Qid> (<lang>)-<speaker>-<word>.<ext>". Only these
# extensions are stored: the frontend plays WAV, Ogg and MP3, and nothing else.
AUDIO_EXTENSIONS = {"wav": "wav", "ogg": "ogg", "oga": "ogg", "mp3": "mp3"}
# German is Q188/"deu" on Lingua Libre; older uploads use the plain "de".
GERMAN_LANGUAGES = frozenset({"deu", "de"})

_LINGUA_RE = re.compile(r"^LL-[^-]+ \(([A-Za-z-]+)\)-(.+)$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS audio (
    word   TEXT NOT NULL,
    format TEXT NOT NULL,
    url    TEXT NOT NULL,
    PRIMARY KEY (word, format)
) WITHOUT ROWID;
"""


def parse_filename(title: str, speaker: str) -> tuple[str, str] | None:
    """Return ``(word, format)`` spoken in a Lingua Libre file, or None.

    ``title`` is the Commons title ("File:LL-Q188 (deu)-NotoriousMonster-Haus.wav")
    or bare name. The speaker is required to split it off: a speaker name and a word
    can both contain a hyphen, so the word can only be cut reliably when the speaker
    is known.
    """
    name = title[5:] if title.lower().startswith("file:") else title
    stem, dot, extension = name.rpartition(".")
    fmt = AUDIO_EXTENSIONS.get(extension.lower()) if dot else None
    if fmt is None:
        return None
    match = _LINGUA_RE.match(stem)
    if match is None or match.group(1).lower() not in GERMAN_LANGUAGES:
        return None
    prefix = speaker + "-"
    rest = match.group(2)
    if not rest.startswith(prefix):
        return None
    word = rest[len(prefix):]
    return (word, fmt) if word else None


def build_map(images: Iterable[dict], speakers: Iterable[str]) -> dict[tuple[str, str], str]:
    """Map ``(word, format) -> URL`` from Commons ``allimages`` records.

    Deterministic: when a word has several recordings of the same format, the
    earliest upload wins (its timestamp), then the URL sorts the rest.
    """
    speaker_list = list(speakers)
    best: dict[tuple[str, str], tuple[str, str]] = {}
    for image in images:
        url = image.get("url")
        if not isinstance(url, str) or not url.startswith(RECORD_AUDIO_PREFIX):
            continue
        url = url.split("?", 1)[0]
        title = image.get("title") or image.get("name") or ""
        if not isinstance(title, str):
            continue
        timestamp = image.get("timestamp") or ""
        if not isinstance(timestamp, str):
            timestamp = ""
        for speaker in speaker_list:
            parsed = parse_filename(title, speaker)
            if parsed is None:
                continue
            key = parsed
            candidate = (timestamp, url)
            if key not in best or candidate < best[key]:
                best[key] = candidate
            break
    return {key: value[1] for key, value in best.items()}


def fetch_speaker_images(speaker: str, limit: int = 500) -> list[dict]:
    """Every file uploaded by ``speaker`` on Commons, via ``list=allimages``."""
    images: list[dict] = []
    continuation: str | None = None
    while True:
        params = {
            "action": "query",
            "format": "json",
            "list": "allimages",
            "aiuser": speaker,
            "aisort": "timestamp",
            "ailimit": str(limit),
            "aiprop": "url|mime|timestamp",
        }
        if continuation:
            params["aicontinue"] = continuation
        request = urllib.request.Request(
            f"{API_URL}?{urllib.parse.urlencode(params)}",
            headers={"User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        images.extend(payload.get("query", {}).get("allimages", []))
        continuation = payload.get("continue", {}).get("aicontinue")
        if not continuation:
            return images


def extract(
    speakers: list[str],
    output_path: Path,
    fetch: Callable[[str], list[dict]] = fetch_speaker_images,
) -> dict:
    stats = {"speakers": len(speakers), "files": 0, "rows": 0}
    images: list[dict] = []
    for speaker in speakers:
        found = fetch(speaker)
        stats["files"] += len(found)
        images.extend(found)

    mapping = build_map(images, speakers)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(output_path)
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT OR IGNORE INTO audio (word, format, url) VALUES (?, ?, ?)",
            sorted((word, fmt, url) for (word, fmt), url in mapping.items()),
        )
        stats["rows"] = conn.execute("SELECT COUNT(*) FROM audio").fetchone()[0]
    finally:
        conn.commit()
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.close()
    return stats


def _load_map(path: Path) -> dict[str, dict[str, str]]:
    """Return ``word -> {format: url}`` from an audio map written by ``extract``."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT word, format, url FROM audio ORDER BY word, format")
        mapping: dict[str, dict[str, str]] = {}
        for word, fmt, url in rows:
            if not isinstance(url, str) or not url.startswith(RECORD_AUDIO_PREFIX):
                continue
            if not isinstance(fmt, str) or not fmt:
                continue
            mapping.setdefault(word, {})[fmt] = url
    finally:
        conn.close()
    return mapping


def merge_into_dictionary(dict_path: Path, mapping: dict[str, dict[str, str]]) -> int:
    """Give a recording to finished entries that have none, returning how many.

    ``mapping`` is ``word -> {format: url}``, the shape ``load_audio_map`` and
    ``_load_map`` return. Only the ``data`` JSON column is written: ``freq``,
    ``freq_rank``, ``search_keys`` and ``autocomplete`` are left alone, so a database
    can take new recordings without being rebuilt. Entries that already have a clip keep
    it. The database is opened read-write (unlike the read-only server).
    """
    if not mapping:
        return 0
    conn = sqlite3.connect(dict_path)
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        by_word: dict[str, list[tuple[int, str]]] = {}
        rows = conn.execute("SELECT id, word, data FROM entries")
        for entry_id, word, data in rows:
            if word in mapping:
                by_word.setdefault(word, []).append((entry_id, data))
        updated = 0
        for word, entries in by_word.items():
            clip = mapping[word]
            for entry_id, data in entries:
                try:
                    record = json.loads(data)
                except (TypeError, ValueError):
                    continue
                if record.get("audio"):
                    continue
                record["audio"] = [dict(clip)]
                conn.execute(
                    "UPDATE entries SET data = ? WHERE id = ?",
                    (
                        json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                        entry_id,
                    ),
                )
                updated += 1
        conn.commit()
    finally:
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.close()
    return updated


def main(argv: list[str] | None = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass

    parser = argparse.ArgumentParser(
        description="Collect Lingua Libre (Wikimedia Commons) recordings for one or "
        "more speakers into a compact word -> URL map for ingest.py --audio-db."
    )
    parser.add_argument(
        "--speaker",
        action="append",
        required=True,
        metavar="NAME",
        help="Commons/Wikimedia user name of the speaker (repeatable)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/audio_commons.db"),
        help="output SQLite path (default: data/audio_commons.db)",
    )
    parser.add_argument(
        "--merge-into",
        type=Path,
        default=None,
        metavar="DICTIONARY_DB",
        help="patch a finished dictionary.db (built without or before this map): "
        "give a recording to its entries that have none, without rebuilding it",
    )
    args = parser.parse_args(argv)

    if args.merge_into is not None and not args.merge_into.is_file():
        parser.error(f"dictionary not found: {args.merge_into}")

    print(f"Reading  Wikimedia Commons for {', '.join(args.speaker)}")
    print(f"Writing  {args.output}")
    try:
        stats = extract(args.speaker, args.output)
    except (urllib.error.URLError, ValueError, OSError) as error:
        parser.error(str(error))

    merged = None
    if args.merge_into is not None:
        print(f"Merging  {args.output} -> {args.merge_into}")
        try:
            mapping = _load_map(args.output)
            merged = merge_into_dictionary(args.merge_into, mapping)
        except (ValueError, OSError, sqlite3.Error) as error:
            parser.error(str(error))

    print(
        f"\nDone\n"
        f"  speakers  : {stats['speakers']:,}\n"
        f"  files     : {stats['files']:,}\n"
        f"  recordings: {stats['rows']:,}\n"
        f"  output    : {args.output}"
        + (
            f"\n  merged    : {merged:,} entries given a recording in {args.merge_into}"
            if merged is not None
            else ""
        )
    )


if __name__ == "__main__":
    main()
