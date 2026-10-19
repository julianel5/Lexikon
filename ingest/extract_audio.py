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

Usage:
    python extract_audio.py --speaker NotoriousMonster -o data/audio_commons.db
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
    args = parser.parse_args(argv)

    print(f"Reading  Wikimedia Commons for {', '.join(args.speaker)}")
    print(f"Writing  {args.output}")
    try:
        stats = extract(args.speaker, args.output)
    except (urllib.error.URLError, ValueError, OSError) as error:
        parser.error(str(error))
    print(
        f"\nDone\n"
        f"  speakers  : {stats['speakers']:,}\n"
        f"  files     : {stats['files']:,}\n"
        f"  recordings: {stats['rows']:,}\n"
        f"  output    : {args.output}"
    )


if __name__ == "__main__":
    main()
