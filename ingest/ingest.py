#!/usr/bin/env python3
"""
Phase 1 - Data Ingest & Processing (Python + SQLite)

Streams a raw kaikki.org German JSONL dump (wiktextract format) line by line,
extracts the fields the dictionary app needs, and writes an optimized,
read-only SQLite database.

Usage:
    python ingest.py data/raw/kaikki.org-dictionary-German.jsonl -o data/dictionary.db
    python ingest.py <dump> -o data/dictionary.db --freq data/raw/deu_web-words.txt   # optional
    python ingest.py <dump> -o data/dictionary.db --ipa-db data/ipa_de.db             # optional

Schema:
    entries(id INTEGER PRIMARY KEY, word TEXT, pos TEXT, gender TEXT, data TEXT /* JSON */,
            freq INTEGER, freq_rank INTEGER)
    search_keys(key TEXT, kind INTEGER, entry_id INTEGER, exact_form INTEGER,
                PRIMARY KEY (kind, key, entry_id)) WITHOUT ROWID

    kind 0 = exact    NFC + lowercase           "schön"   -> "schön"
    kind 1 = translit ä→ae ö→oe ü→ue ß→ss       "schön"   -> "schoen"
    kind 2 = strip    ä→a  ö→o  ü→u  ß→s        "schön"   -> "schon"
    kind 3 = english  word taken from a gloss    "to go"   -> "go"   (reverse search)

    For kind 3, exact_form is a relevance score (higher is better), not a flag:
        4  a whole translation of the first sense        "to go"      -> go
        3  a whole translation of a later sense
        2  a word of the headline glosses (first sense, first glosses)
        1  a word found anywhere else in the glosses
    These keys are never used for autocomplete.

    Every entry gets all three keys (even when the folded values coincide) so
    that query-time lookups are symmetric: a query for "Fuß" transforms to
    kind1 "fuss" and must find the entry spelled "Fuss", and vice versa.
    Ranking (kind 0 before 1 before 2) is applied by the backend.

    exact_form = 1  key came from the entry's own headword
    exact_form = 0  key came from an inflected/alternative form; pages that are
                    pure inflections ("Häuser" -> "plural of Haus") are not
                    stored as entries, they only contribute redirect keys to
                    their lemma.

    autocomplete(kind, key, entry_id, word, pos, weight, freq)  -- headword keys only,
        used for prefix suggestions (ranked by ``weight`` = entry size).

    freq / freq_rank (only with --freq, otherwise 0): how often the entry's headword and
        inflected forms occur in a word list of the Leipzig Corpora Collection (see
        THIRD_PARTY_NOTICES.md), and the entry's rank by that count (1 = most frequent,
        0 = not in the list).

Notes:
  * The database is built with journal_mode=OFF / synchronous=OFF for speed.
    This is safe here because the .db is a pure build artifact - if a run is
    interrupted, delete it and run again. The script switches journal_mode
    back to DELETE before finishing.
  * Progress bar uses tqdm when installed (see requirements.txt), otherwise
    plain periodic log lines.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import unicodedata
import zipfile
from collections.abc import Iterable
from pathlib import Path

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

DEFAULT_BATCH = 5_000
FALLBACK_EVERY_LINES = 500_000

KIND_EXACT = 0
KIND_TRANSLIT = 1
KIND_STRIP = 2
KIND_ENGLISH = 3
KIND_NAMES = {
    KIND_EXACT: "exact",
    KIND_TRANSLIT: "translit",
    KIND_STRIP: "strip",
    KIND_ENGLISH: "english",
}

TRANSLIT_TABLE = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})
STRIP_TABLE = str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "s"})

GENDER_LABELS = {"m": "masculine", "f": "feminine", "n": "neuter"}
GENDER_SENSE_TAGS = {"masculine": "m", "feminine": "f", "neuter": "n"}
ARTICLES = {"masculine": "der", "feminine": "die", "neuter": "das"}
GENDER_POS = frozenset({"noun", "name"})

JUNK_FORMS = frozenset({"", "-", "—", "−", "?", "–"})
JUNK_FORM_TAGS = frozenset({"table-tags", "inflection-template", "class", "auxiliary"})

RELATION_FIELDS = (
    "synonyms",
    "antonyms",
    "derived",
    "related",
    "hypernyms",
    "hyponyms",
    "holonyms",
    "meronyms",
    "coordinate_terms",
)
MAX_RELATIONS = 25
MAX_SENSES = 50
MAX_FORMS = 100

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id     INTEGER PRIMARY KEY,
    word   TEXT    NOT NULL,
    pos    TEXT    NOT NULL,
    gender TEXT,
    data   TEXT    NOT NULL,
    freq      INTEGER NOT NULL DEFAULT 0,
    freq_rank INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS search_keys (
    key        TEXT    NOT NULL,
    kind       INTEGER NOT NULL,
    entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    exact_form INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (kind, key, entry_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_entries_word_pos ON entries(word, pos);
"""


# --------------------------------------------------------------------------- #
# Search-key folding (identical functions run at index time and query time)
# --------------------------------------------------------------------------- #
def exact_key(word: str) -> str:
    return unicodedata.normalize("NFC", word).lower()


def translit_key(word: str) -> str:
    return exact_key(word).translate(TRANSLIT_TABLE)


def strip_key(word: str) -> str:
    return exact_key(word).translate(STRIP_TABLE)


def iter_keys(word: str):
    yield KIND_EXACT, exact_key(word)
    yield KIND_TRANSLIT, translit_key(word)
    yield KIND_STRIP, strip_key(word)


# --------------------------------------------------------------------------- #
# Reverse (English -> German) search keys
# --------------------------------------------------------------------------- #
# Words that carry no meaning on their own: articles, prepositions, conjunctions and the
# placeholders glosses use ("to give something to someone"). Content words such as "be",
# "have" or "not" are kept on purpose: they are the main translation of sein, haben, nicht.
ENGLISH_STOPWORDS = frozenset(
    """
    a an the of in on at by for with from into onto and or as to it its
    that which who whom whose this these those
    one ones oneself someone somebody something someones somebodys somethings
    etc eg ie
    """.split()
)

# "(of a person)", "[figuratively]": context labels, not translations
_QUALIFIER_RE = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_ENGLISH_TOKEN_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")

# Glosses that describe the word itself instead of translating it ("alternative spelling of
# Haus", "plural of ...", "obsolete form of ..."): indexing them would make "spelling" or
# "alternative" match thousands of unrelated entries.
_META_GLOSS_RE = re.compile(
    r"^(?:\S+\s+){0,6}?(?:"
    r"spelling|variant|abbreviation|initialism|acronym|contraction|clipping|misspelling|"
    r"romanization|synonym|diminutive|"
    r"plural|genitive|dative|accusative|nominative|participle|"
    r"(?:alternative|inflected|obsolete|archaic|dated|nonstandard|informal|rare|older) form"
    r")\s+(?:\S+\s+){0,3}?of\b"
)

# The first glosses of the first sense are the entry's headline translation
HEADLINE_GLOSSES = 3
# Relevance of an English key (stored in search_keys.exact_form for kind 3)
SCORE_WHOLE_FIRST_SENSE = 4
SCORE_WHOLE_LATER_SENSE = 3
SCORE_HEADLINE = 2
SCORE_MENTION = 1
# Upper bound of distinct English keys per entry (very long entries would otherwise dominate)
MAX_ENGLISH_KEYS = 60


def _clean_english(text: str) -> str:
    """NFC, lower-cased, typographic apostrophes straightened, qualifiers removed."""
    text = unicodedata.normalize("NFC", text).lower().replace("\u2019", "'")
    return _QUALIFIER_RE.sub(" ", text).strip()


def _english_words_of(clean: str) -> list[str]:
    out = []
    for token in _ENGLISH_TOKEN_RE.findall(clean):
        token = token.removesuffix("'s")
        if token in ENGLISH_STOPWORDS or token.endswith("'"):
            continue
        if len(token) < 2 and token != "i":  # keep "I" (ich), drop stray letters
            continue
        out.append(token)
    return out


def english_words(text: str) -> list[str]:
    """Lower-cased content words of a piece of English text.

    The same function (ported to TypeScript as ``englishWords`` in ``server/src/english.ts``)
    tokenises a multi-word search query at query time, so a query is cut exactly like the
    glosses were; ``fixtures/english_cases.json`` checks both ports.
    """
    return _english_words_of(_clean_english(text))


def english_tokens(gloss: str) -> list[str]:
    """Content words of one gloss, or none if the gloss only describes the word itself."""
    clean = _clean_english(gloss)
    if _META_GLOSS_RE.match(clean):
        return []
    return _english_words_of(clean)


def english_keys(senses: list[dict]) -> list[tuple[str, int]]:
    """(key, score) pairs for the reverse index of one entry.

    The score says how central the English word is to the entry (see SCORE_*): a gloss part
    that is exactly that word ("water" for Wasser, "to go" for gehen) beats a word that only
    appears inside a longer description ("a small house" for Häusl). Senses are visited in
    order and the best score per word wins, so the per-entry cap drops the least relevant
    keys last.
    """
    keys: dict[str, int] = {}
    for sense_index, sense in enumerate(senses):
        for gloss_index, gloss in enumerate(sense.get("glosses") or []):
            headline = sense_index == 0 and gloss_index < HEADLINE_GLOSSES
            # Drop the qualifiers *before* splitting: they may contain commas or semicolons
            # ("book (collection of sheets; long work)") that are not separators.
            plain = _QUALIFIER_RE.sub(" ", gloss)
            for part in re.split(r"[;,]", plain):
                tokens = english_tokens(part)
                whole = len(tokens) == 1
                for token in tokens:
                    if whole:
                        score = SCORE_WHOLE_FIRST_SENSE if sense_index == 0 else SCORE_WHOLE_LATER_SENSE
                    elif headline:
                        score = SCORE_HEADLINE
                    else:
                        score = SCORE_MENTION
                    if token in keys:
                        keys[token] = max(keys[token], score)
                    elif len(keys) < MAX_ENGLISH_KEYS:
                        keys[token] = score
    return list(keys.items())


# --------------------------------------------------------------------------- #
# Field extraction
# --------------------------------------------------------------------------- #
def _parse_gender(token) -> str | None:
    """Real kaikki de-noun args look like 'n,,^er' (gender,genitive,plural),
    'm.weak', 'mf', 'm:n' ... reduce to the m/f/n part, else None."""
    if not isinstance(token, str):
        return None
    core = token.split(",", 1)[0]
    core = core.split(".", 1)[0]
    for sep in "/+:":
        core = core.replace(sep, "")
    core = core.strip().lower()
    if not core or any(ch not in "mfn" for ch in core):
        return None
    parts = [g for g in "mfn" if g in core]
    return "+".join(GENDER_LABELS[p] for p in parts)


def _extract_gender(entry: dict, pos: str) -> str | None:
    if pos not in GENDER_POS:
        return None
    for template in entry.get("head_templates") or []:
        args = template.get("args") or {}
        for candidate in (args.get("g"), args.get("1")):
            gender = _parse_gender(candidate)
            if gender:
                return gender
    # Fallback: German noun/proper-noun entries repeat the grammatical gender
    # in their sense tags (e.g. ["neuter", "strong"], ["feminine", "plural-only"]).
    found: set[str] = set()
    for sense in entry.get("senses") or []:
        if isinstance(sense, dict):
            found.update(
                GENDER_SENSE_TAGS[tag]
                for tag in sense.get("tags") or []
                if tag in GENDER_SENSE_TAGS
            )
    if found:
        parts = [g for g in "mfn" if g in found]
        return "+".join(GENDER_LABELS[p] for p in parts)
    return None


def _article_for(gender: str | None) -> str | None:
    if not gender:
        return None
    return "/".join(ARTICLES[g] for g in gender.split("+"))


def _extract_plural(forms: list[dict]) -> str | None:
    for form in forms:
        if "plural" in form["tags"]:
            return form["form"]
    return None


def _extract_verb_info(entry: dict) -> tuple[str | None, bool | None]:
    """Auxiliary comes from forms tagged 'auxiliary' (haben / sein / "haben or
    sein"); separability from the de-verb stem, where '.' marks a separable
    prefix ("auf.stehen<...>" vs "verstehen<...>")."""
    aux_forms = [
        form["form"]
        for form in entry.get("forms") or []
        if isinstance(form, dict)
        and "auxiliary" in (form.get("tags") or [])
        and isinstance(form.get("form"), str)
    ]
    auxiliary = None
    for text in aux_forms:
        if " or " in text:
            auxiliary = text.replace(" or ", "/")
            break
    if auxiliary is None and aux_forms:
        auxiliary = aux_forms[0]

    separable = None
    for template in entry.get("head_templates") or []:
        if not str(template.get("name") or "").startswith("de-verb"):
            continue
        for value in (template.get("args") or {}).values():
            if not isinstance(value, str):
                continue
            if value in ("sep", "separable", "trennbar"):
                separable = True
            elif value in ("insep", "inseparable", "untrennbar"):
                separable = False
            elif "." in value.split("<", 1)[0]:
                separable = True
            elif separable is None:
                separable = False
    return auxiliary, separable


def _sanitize_forms(entry: dict, word: str) -> list[dict]:
    forms: list[dict] = []
    seen: set[tuple] = set()
    for form_obj in entry.get("forms") or []:
        if not isinstance(form_obj, dict):
            continue
        form = (form_obj.get("form") or "").strip()
        tags = [t for t in form_obj.get("tags") or [] if isinstance(t, str) and t]
        if form in JUNK_FORMS or form == word or "{{" in form:
            continue
        if JUNK_FORM_TAGS.intersection(tags):
            continue
        signature = (form, tuple(sorted(tags)))
        if signature in seen:
            continue
        seen.add(signature)
        forms.append({"form": form, "tags": tags})
    return forms[:MAX_FORMS]


def _extract_examples(sense: dict) -> list[dict]:
    examples = []
    for item in sense.get("examples") or []:
        if isinstance(item, str):
            if item:
                examples.append({"text": item})
        elif isinstance(item, dict) and item.get("text"):
            example = {"text": item["text"]}
            translation = item.get("translation")
            if isinstance(translation, str) and translation:
                example["en"] = translation
            examples.append(example)
    return examples


def _relation_item(item):
    """Keep only the public fields of a relation entry; kaikki embeds internal
    bookkeeping keys (e.g. '_dis1' disambiguation) that must not leak out."""
    if isinstance(item, str):
        return item or None
    if not isinstance(item, dict):
        return None
    clean = {
        key: value
        for key, value in item.items()
        if not key.startswith("_") and value not in (None, "", [], {})
    }
    return clean or None



def _extract_components(entry: dict) -> list[str]:
    """Extract compound constituents from etymology_templates (Kaikki).

    German Wiktionary spells the same idea with several template names: the long
    forms (``compound``/``affix``/``suffix``/``prefix``) and the short aliases
    (``com``/``com+``/``af``/``suf``). All of them carry the constituents as
    numeric ``args`` starting at 2; some wrap them in gloss markup like
    ``Schraube<t:screw>``, which is stripped before use.
    """
    components: list[str] = []
    seen: set[str] = set()
    names = {"compound", "compounding", "com", "com+", "affix", "af", "suffix", "suf", "prefix"}
    for tmpl in entry.get("etymology_templates") or []:
        if not isinstance(tmpl, dict):
            continue
        name = str(tmpl.get("name") or "").lower()
        if name not in names:
            continue
        args = tmpl.get("args") or {}
        if not isinstance(args, dict):
            continue
        # Collect numeric arg keys in ascending order (constituents usually 2,3,...)
        for key in sorted(args.keys(), key=lambda k: (int(k) if str(k).isdigit() else 10**12)):
            if not str(key).isdigit():
                continue
            idx = int(key)
            if idx < 2:  # skip language code (1)
                continue
            val = args.get(key)
            if not isinstance(val, str) or not val.strip():
                continue
            part = re.sub(r"<[^>]*>", "", val).strip()
            if part and part not in seen:
                seen.add(part)
                components.append(part)
    if not components:
        for tmpl in entry.get("etymology_templates") or []:
            if not isinstance(tmpl, dict):
                continue
            name = str(tmpl.get("name") or "").lower()
            if name != "compound":
                continue
            exp = tmpl.get("expansion") or ""
            if not isinstance(exp, str):
                continue
            for token in exp.split("+"):
                t = token.strip()
                t2 = re.sub(r"\([^)]*\)", "", t).strip()
                if not t2:
                    continue
                m = re.match(r"([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)", t2)
                if m and m.group(1) not in seen:
                    seen.add(m.group(1))
                    components.append(m.group(1))
    return components


def _relations(source: dict) -> dict:
    out = {}
    for field in RELATION_FIELDS:
        value = source.get(field)
        if not isinstance(value, list) or not value:
            continue
        items = []
        for item in value:
            cleaned = _relation_item(item)
            if cleaned is not None:
                items.append(cleaned)
        if items:
            out[field] = items[:MAX_RELATIONS]
    return out


def _extract_senses(entry: dict) -> list[dict]:
    senses = []
    for sense in entry.get("senses") or []:
        if not isinstance(sense, dict) or sense.get("form_of"):
            continue
        glosses = [g for g in sense.get("glosses") or [] if isinstance(g, str) and g]
        if not glosses:
            continue
        out: dict = {"glosses": glosses}
        tags = [t for t in sense.get("tags") or [] if isinstance(t, str) and t]
        if tags:
            out["tags"] = tags
        topics = [t for t in sense.get("topics") or [] if isinstance(t, str) and t]
        if topics:
            out["topics"] = topics
        examples = _extract_examples(sense)
        if examples:
            out["examples"] = examples
        out.update(_relations(sense))
        senses.append(out)
        if len(senses) >= MAX_SENSES:
            break
    return senses


def _extract_sounds(entry: dict) -> list[dict]:
    sounds = []
    for sound in entry.get("sounds") or []:
        if not isinstance(sound, dict):
            continue
        ipa = sound.get("ipa")
        if isinstance(ipa, str) and ipa:
            item = {"ipa": ipa}
            tags = [t for t in sound.get("tags") or [] if isinstance(t, str) and t]
            if tags:
                item["tags"] = tags
            sounds.append(item)
    return sounds


AUDIO_URL_PREFIX = "https://upload.wikimedia.org/"


def _extract_audio(entry: dict) -> list[dict]:
    """Native-speaker recordings (Wikimedia Commons) attached to the entry.

    Each item carries an ``mp3`` and/or ``ogg`` URL (mp3 first: Safari cannot
    play Ogg) plus the regional tags (e.g. ``Germany``, ``Austria``).
    """
    audio = []
    seen = set()
    for sound in entry.get("sounds") or []:
        if not isinstance(sound, dict):
            continue
        item = {}
        for key, field in (("mp3", "mp3_url"), ("ogg", "ogg_url")):
            url = sound.get(field)
            if isinstance(url, str) and url.startswith(AUDIO_URL_PREFIX):
                item[key] = url
        if not item:
            continue
        marker = item.get("mp3") or item["ogg"]
        if marker in seen:
            continue
        seen.add(marker)
        tags = [t for t in sound.get("tags") or [] if isinstance(t, str) and t]
        if tags:
            item["tags"] = tags
        audio.append(item)
    return audio


def _inflection_target(entry: dict) -> tuple[str, str] | None:
    """If every sense inflects another word, return (lemma, pos) instead of
    storing this page as a standalone entry."""
    senses = entry.get("senses") or []
    if not senses:
        return None
    lemma = None
    for sense in senses:
        if not isinstance(sense, dict):
            return None
        form_of = sense.get("form_of")
        if not form_of or not form_of[0].get("word"):
            return None
        candidate = form_of[0]["word"]
        if lemma is not None and lemma != candidate:
            return None
        lemma = candidate
    return lemma, entry.get("pos") or ""


def _build_record(entry: dict, word: str, pos: str, senses: list[dict]) -> dict:
    forms = _sanitize_forms(entry, word)
    gender = _extract_gender(entry, pos)
    record = {
        "word": word,
        "pos": pos,
        "gender": gender,
        "article": _article_for(gender),
        "plural": _extract_plural(forms),
        "forms": forms,
        "senses": senses,
    }
    if pos == "verb":
        auxiliary, separable = _extract_verb_info(entry)
        if auxiliary:
            record["auxiliary"] = auxiliary
        if separable is not None:
            record["separable"] = separable
    sounds = _extract_sounds(entry)
    if sounds:
        record["sounds"] = sounds
    audio = _extract_audio(entry)
    if audio:
        record["audio"] = audio
    components = _extract_components(entry)
    if components:
        record["components"] = components
    record.update(_relations(entry))
    return record


# --------------------------------------------------------------------------- #
# Pronunciation enrichment (optional)
# --------------------------------------------------------------------------- #
def load_ipa_map(path: Path) -> dict[tuple[str, str], list[str]]:
    """Read a ``(word, pos) -> [ipa, ...]`` map built by ``extract_ipa.py``.

    Used to fill entries whose source dump has no pronunciation (e.g. "schleißen",
    which carries only audio on en.wiktionary). Rows are ordered so the list is
    deterministic. The map is opened read-only: the build never writes to it.
    """
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT word, pos, ipa FROM ipa ORDER BY word, pos, ipa")
        ipa_map: dict[tuple[str, str], list[str]] = {}
        for word, pos, ipa in rows:
            ipa_map.setdefault((word, pos), []).append(ipa)
    finally:
        conn.close()
    return ipa_map


# --------------------------------------------------------------------------- #
# Word frequencies (optional)
# --------------------------------------------------------------------------- #
# Letters only, optionally joined by hyphens or apostrophes: drops punctuation, numbers, URLs.
_FREQ_TOKEN_RE = re.compile(r"[^\W\d_]+(?:['\u2019-][^\W\d_]+)*")
_YOMITAN_COUNT_RE = re.compile(r"\((\d+)\)")


def _add_count(counts: dict[str, int], word: str, count: int) -> None:
    word = unicodedata.normalize("NFC", word)
    if count > 0 and _FREQ_TOKEN_RE.fullmatch(word):
        counts[word] = counts.get(word, 0) + count


def load_frequencies(path: Path) -> dict[str, int]:
    """Read a word list into {word: occurrences}. Case is kept: German nouns are capitalised.

    Two formats are understood:
      * a Leipzig Corpora Collection ``*-words.txt``: tab-separated ``id, word, count`` lines;
      * a Yomitan frequency dictionary (``.zip``, e.g. from leipzig-to-yomitan): the count is
        read from the ``displayValue`` of its ``term_meta_bank_*.json`` rows ("12 (3456)").
    """
    counts: dict[str, int] = {}
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            banks = sorted(n for n in archive.namelist() if n.startswith("term_meta_bank"))
            for name in banks:
                for row in json.loads(archive.read(name)):
                    try:
                        word, kind, meta = row[0], row[1], row[2]
                        match = _YOMITAN_COUNT_RE.search(meta["displayValue"])
                    except (IndexError, KeyError, TypeError):
                        continue
                    if kind == "freq" and match:
                        _add_count(counts, word, int(match.group(1)))
    else:
        with path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.rstrip("\r\n").split("\t")
                if len(parts) >= 3 and parts[2].isdigit():
                    _add_count(counts, parts[1], int(parts[2]))
    if not counts:
        raise ValueError(
            f"no word counts found in {path}: expected a Leipzig '*-words.txt' "
            "(id, word, count) or a Yomitan frequency zip that lists occurrence counts"
        )
    return counts


# A capitalised spelling of a lower-case word is counted only up to this many times the count of
# the lower-case one. "Ich" at the start of a sentence is about half as frequent as "ich"; but
# "Haus" is 170 times as frequent as "haus" (the imperative of "hausen"): it is the noun.
CAPITAL_VARIANT_MAX_RATIO = 3


def surface_variants(form: str) -> list[str]:
    """Spellings under which a form can appear in running text.

    A lower-case word also starts sentences with a capital ("Ich"); a capitalised one (a
    noun) is left alone, as its lower-case spelling is a different, rare token.
    """
    form = unicodedata.normalize("NFC", form)
    variants = [form]
    if form[:1].islower():
        variants.append(form[:1].upper() + form[1:])
    return variants


def _counted_variants(form: str, counts: dict[str, int], capital_ok: bool = False) -> list[str]:
    """The spellings of a form that are in the word list and plausibly are that form.

    ``capital_ok`` skips the limit on the capitalised spelling: interjections ("Hallo", "Prost",
    "Hi") almost always start the sentence, so they are far more frequent capitalised.
    """
    variants = surface_variants(form)
    base = counts.get(variants[0], 0)
    return [
        variant
        for index, variant in enumerate(variants)
        if variant in counts
        and (index == 0 or capital_ok or counts[variant] <= CAPITAL_VARIANT_MAX_RATIO * base)
    ]


def compute_frequencies(
    entries: Iterable[tuple[int, Iterable[str], Iterable[str]] | tuple[int, Iterable[str], Iterable[str], bool]],
    counts: dict[str, int],
) -> dict[int, int]:
    """Occurrences per entry, from the word list.

    Each entry is ``(id, owned, listed)``, or ``(id, owned, listed, capital_ok)`` for an
    interjection (see ``_counted_variants``). *Owned* spellings are the ones Wiktionary has a page
    for: the headword and the inflected-form pages that point to the entry ("Häuser" -> Haus).
    *Listed* spellings are only mentioned in the entry's table of forms.

    A spelling is counted for the entries that own it. Only when nobody owns it is it split
    evenly between the entries that list it. This matters because tables list more than the
    entry's own forms: a personal pronoun lists the whole paradigm ("mir" under "ich"), and
    the entries of names list their articles ("die", "der"). Those spellings belong to the
    pages of their own ("mir", "der"), not to every entry that mentions them.
    """
    owners: dict[str, set[int]] = {}
    listers: dict[str, set[int]] = {}
    for entry_id, owned, listed, *rest in entries:
        capital_ok = bool(rest and rest[0])
        for form in owned:
            for variant in _counted_variants(form, counts, capital_ok):
                owners.setdefault(variant, set()).add(entry_id)
        for form in listed:
            for variant in _counted_variants(form, counts, capital_ok):
                listers.setdefault(variant, set()).add(entry_id)
    totals: dict[int, float] = {}
    for variant in owners.keys() | listers.keys():
        receivers = owners.get(variant) or listers[variant]
        share = counts[variant] / len(receivers)
        for entry_id in receivers:
            totals[entry_id] = totals.get(entry_id, 0.0) + share
    return {entry_id: round(total) for entry_id, total in totals.items() if round(total) > 0}


def _apply_frequencies(
    conn: sqlite3.Connection, counts: dict[str, int], redirect_forms: dict[int, list[str]]
) -> dict:
    """Fill entries.freq / freq_rank from the word list; returns a few numbers for the report."""

    def entries():
        for entry_id, word, pos, data in conn.execute("SELECT id, word, pos, data FROM entries"):
            owned = [word, *redirect_forms.get(entry_id, ())]
            listed = [f["form"] for f in json.loads(data).get("forms", [])]
            yield entry_id, owned, listed, pos == "intj"

    freqs = compute_frequencies(entries(), counts)
    ranked = sorted(freqs, key=lambda entry_id: (-freqs[entry_id], entry_id))
    conn.executemany(
        "UPDATE entries SET freq = ?, freq_rank = ? WHERE id = ?",
        ((freqs[entry_id], rank, entry_id) for rank, entry_id in enumerate(ranked, start=1)),
    )
    return {"freq_entries": len(ranked), "freq_words": len(counts)}


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #
AUTOCOMPLETE_SCHEMA = """
CREATE TABLE autocomplete (
    kind     INTEGER NOT NULL,
    key      TEXT    NOT NULL,
    entry_id INTEGER NOT NULL,
    word     TEXT    NOT NULL,
    pos      TEXT    NOT NULL,
    weight   INTEGER NOT NULL,
    freq     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, key, entry_id)
) WITHOUT ROWID;
"""


def _build_autocomplete(conn: sqlite3.Connection) -> None:
    """Narrow prefix-search table: one row per headword key.

    ``weight`` is the size of the entry's JSON: well-documented (common)
    words have much richer Wiktionary entries than abbreviations or rare
    names, so it is a cheap popularity proxy for ranking suggestions.
    """
    conn.executescript(AUTOCOMPLETE_SCHEMA)
    conn.execute(
        """
        INSERT INTO autocomplete (kind, key, entry_id, word, pos, weight, freq)
        SELECT k.kind, k.key, k.entry_id, e.word, e.pos, length(e.data), e.freq
        FROM search_keys k
        JOIN entries e ON e.id = k.entry_id
        WHERE k.exact_form = 1 AND k.kind < 3
        """
    )


def _connect(output: Path) -> sqlite3.Connection:
    if output.exists():
        output.unlink()
    output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(output)
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-65536")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def run(
    input_path: Path,
    output_path: Path,
    batch_size: int,
    frequencies: dict[str, int] | None = None,
    ipa_map: dict[tuple[str, str], list[str]] | None = None,
) -> dict:
    file_size = input_path.stat().st_size
    conn = _connect(output_path)

    stats = {
        "lines": 0,
        "malformed": 0,
        "skipped_lang": 0,
        "skipped_no_pos": 0,
        "form_pages": 0,
        "skipped_empty": 0,
        "entries": 0,
        "keys": 0,
        "redirects_resolved": 0,
        "redirects_unresolved": 0,
        "ipa_filled": 0,
    }
    # (inflected form, lemma word, lemma pos) -> None; dict = ordered de-dup set
    redirects: dict[tuple[str, str, str], None] = {}
    entry_rows: list[tuple] = []
    key_rows: list[tuple] = []
    next_id = 0
    # lemma id -> inflected forms of redirected pages (only kept when frequencies are used)
    redirect_forms: dict[int, list[str]] = {}

    def flush() -> None:
        nonlocal entry_rows, key_rows
        if entry_rows:
            conn.executemany(
                "INSERT INTO entries (id, word, pos, gender, data) VALUES (?, ?, ?, ?, ?)",
                entry_rows,
            )
            stats["entries"] += len(entry_rows)
            entry_rows = []
        if key_rows:
            before = conn.total_changes
            conn.executemany(
                "INSERT OR IGNORE INTO search_keys (key, kind, entry_id, exact_form) "
                "VALUES (?, ?, ?, ?)",
                key_rows,
            )
            stats["keys"] += conn.total_changes - before
            key_rows = []

    started = time.perf_counter()
    bar = (
        tqdm(total=file_size, unit="B", unit_scale=True, desc="ingest")
        if tqdm is not None
        else None
    )

    with input_path.open("rb") as fh:
        for raw in fh:
            if bar is not None:
                bar.update(len(raw))
            if not raw.strip():
                continue
            stats["lines"] += 1
            if bar is None and stats["lines"] % FALLBACK_EVERY_LINES == 0:
                print(f"  ... {stats['lines']:,} lines", flush=True)

            try:
                entry = json.loads(raw)
            except ValueError:
                stats["malformed"] += 1
                continue
            if not isinstance(entry, dict) or entry.get("lang_code") != "de":
                stats["skipped_lang"] += 1
                continue

            word = entry.get("word")
            pos = entry.get("pos")
            if not word or not pos:
                stats["skipped_no_pos"] += 1
                continue

            target = _inflection_target(entry)
            if target is not None:
                lemma, lemma_pos = target
                if lemma != word:
                    redirects[(word, lemma, lemma_pos)] = None
                stats["form_pages"] += 1
                continue

            senses = _extract_senses(entry)
            if not senses:
                stats["skipped_empty"] += 1
                continue

            next_id += 1
            record = _build_record(entry, word, pos, senses)
            if ipa_map is not None and "sounds" not in record:
                ipas = ipa_map.get((word, pos))
                if ipas:
                    record["sounds"] = [{"ipa": ipa} for ipa in ipas]
                    stats["ipa_filled"] += 1
            entry_rows.append(
                (
                    next_id,
                    word,
                    pos,
                    record["gender"],
                    json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                )
            )
            for kind, key in iter_keys(word):
                key_rows.append((key, kind, next_id, 1))
            for form in record["forms"]:
                for kind, key in iter_keys(form["form"]):
                    key_rows.append((key, kind, next_id, 0))
            for key, score in english_keys(senses):
                key_rows.append((key, KIND_ENGLISH, next_id, score))

            if len(entry_rows) >= batch_size:
                flush()
                conn.commit()

    if bar is not None:
        bar.close()
    flush()
    conn.commit()

    # --- resolve inflected-form pages to their lemma entries ----------------
    for form, lemma, lemma_pos in redirects:
        row = conn.execute(
            "SELECT id FROM entries WHERE word = ? AND pos = ? ORDER BY id LIMIT 1",
            (lemma, lemma_pos),
        ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT id FROM entries WHERE word = ? ORDER BY id LIMIT 1",
                (lemma,),
            ).fetchone()
        if row is None:
            stats["redirects_unresolved"] += 1
            continue
        lemma_id = row[0]
        if frequencies is not None:
            redirect_forms.setdefault(lemma_id, []).append(form)
        for kind, key in iter_keys(form):
            key_rows.append((key, kind, lemma_id, 0))
        stats["redirects_resolved"] += 1
        if len(key_rows) >= batch_size * 3:
            flush()
            conn.commit()
    flush()
    conn.commit()

    if frequencies is not None:
        stats.update(_apply_frequencies(conn, frequencies, redirect_forms))
        conn.commit()

    _build_autocomplete(conn)
    conn.commit()

    conn.execute("ANALYZE")
    conn.commit()
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    conn.execute("PRAGMA journal_mode=DELETE").fetchone()
    conn.close()

    stats["elapsed"] = time.perf_counter() - started
    stats["file_size"] = file_size
    stats["db_size"] = output_path.stat().st_size
    stats["integrity"] = integrity
    return stats


def verify(output_path: Path) -> None:
    probes = [
        (KIND_TRANSLIT, translit_key("schön")),
        (KIND_STRIP, strip_key("schon")),
        (KIND_TRANSLIT, translit_key("Fuß")),
        (KIND_STRIP, strip_key("Fus")),
        (KIND_EXACT, exact_key("Häuser")),
    ]
    conn = sqlite3.connect(output_path)
    print("\n[verify] sample lookups")
    for kind, probe in probes:
        rows = conn.execute(
            "SELECT e.word, e.pos FROM search_keys k "
            "JOIN entries e ON e.id = k.entry_id "
            "WHERE k.kind = ? AND k.key = ? ORDER BY e.word LIMIT 5",
            (kind, probe),
        ).fetchall()
        found = ", ".join(f"{w} ({p})" for w, p in rows) if rows else "(no match)"
        print(f"  {KIND_NAMES[kind]:9s} '{probe}' -> {found}")
    conn.close()


def _frequency_line(stats: dict) -> str:
    if "freq_entries" not in stats:
        return ""
    share = stats["freq_entries"] / max(stats["entries"], 1)
    return (
        f"  frequencies  : {stats['freq_entries']:,} of {stats['entries']:,} entries "
        f"({share:.0%}) found in a list of {stats['freq_words']:,} words\n"
    )


def _ipa_line(stats: dict) -> str:
    if not stats.get("ipa_filled"):
        return ""
    return (
        f"  ipa filled   : {stats['ipa_filled']:,} entries given a pronunciation "
        f"from the map\n"
    )


def report(stats: dict, output_path: Path) -> None:
    redirects = (
        f"{stats['form_pages']:,} redirected "
        f"({stats['redirects_resolved']:,} resolved, "
        f"{stats['redirects_unresolved']:,} unresolved)"
    )
    skipped = (
        f"{stats['malformed']:,} malformed, {stats['skipped_lang']:,} non-german, "
        f"{stats['skipped_no_pos']:,} no pos, {stats['skipped_empty']:,} empty"
    )
    print(
        f"\nDone in {stats['elapsed']:.1f}s\n"
        f"  input        : {stats['file_size'] / 1e6:,.1f} MB, {stats['lines']:,} lines\n"
        f"  entries      : {stats['entries']:,}\n"
        f"  search_keys  : {stats['keys']:,}\n"
        f"  form pages   : {redirects}\n"
        f"  skipped      : {skipped}\n"
        f"{_frequency_line(stats)}"
        f"{_ipa_line(stats)}"
        f"  integrity    : {stats['integrity']}\n"
        f"  output       : {output_path} ({stats['db_size'] / 1e6:,.1f} MB)"
    )


def main(argv: list[str] | None = None) -> None:
    # Windows consoles/redirects often default to a legacy codepage (cp1252,
    # cp932, ...) that cannot print umlauts; force UTF-8 output.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass

    parser = argparse.ArgumentParser(
        description="Build the German->English dictionary SQLite database "
        "from a kaikki.org German JSONL dump."
    )
    parser.add_argument("input", type=Path, help="path to kaikki.org-dictionary-German.jsonl")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/dictionary.db"),
        help="output SQLite path (default: data/dictionary.db)",
    )
    parser.add_argument(
        "-b",
        "--batch",
        type=int,
        default=DEFAULT_BATCH,
        help=f"rows per insert transaction (default: {DEFAULT_BATCH})",
    )
    parser.add_argument(
        "--freq",
        type=Path,
        default=None,
        help="word frequency list: a Leipzig '*-words.txt' or a Yomitan frequency .zip "
        "(optional; adds entries.freq and entries.freq_rank)",
    )
    parser.add_argument(
        "--ipa-db",
        type=Path,
        default=None,
        help="optional (word,pos)->IPA map built by extract_ipa.py from the de.wiktionary "
        "dump; fills entries whose source dump has no pronunciation",
    )
    parser.add_argument("--no-verify", action="store_true", help="skip post-build lookups")
    args = parser.parse_args(argv)

    if not args.input.is_file():
        parser.error(f"input file not found: {args.input}")
    if args.batch < 1:
        parser.error("--batch must be >= 1")
    if args.freq is not None and not args.freq.is_file():
        parser.error(f"frequency list not found: {args.freq}")
    if args.ipa_db is not None and not args.ipa_db.is_file():
        parser.error(f"IPA map not found: {args.ipa_db}")

    print(f"Reading  {args.input}")
    print(f"Writing  {args.output}")
    frequencies = None
    if args.freq is not None:
        print(f"Reading  {args.freq} (word frequencies)")
        try:
            frequencies = load_frequencies(args.freq)
        except (ValueError, OSError, zipfile.BadZipFile) as error:
            parser.error(str(error))
    ipa_map = None
    if args.ipa_db is not None:
        print(f"Reading  {args.ipa_db} (IPA map)")
        try:
            ipa_map = load_ipa_map(args.ipa_db)
        except (ValueError, OSError, sqlite3.Error) as error:
            parser.error(str(error))
    stats = run(args.input, args.output, args.batch, frequencies, ipa_map)
    report(stats, args.output)
    if not args.no_verify:
        verify(args.output)


if __name__ == "__main__":
    main()
