"""Search-key folding tests.

``server/src/fold.ts`` must produce byte-for-byte the same keys as the functions in
``ingest.py``, or lookups silently miss. Both sides are checked against the same expected
values in ``fixtures/fold_cases.json`` (the TypeScript side is ``server/test/fold.test.ts``).

Run from the repository root:  python -m unittest discover -s ingest -p "test_*.py"
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import ingest

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "fold_cases.json").read_text(encoding="utf-8")
)


class FoldTests(unittest.TestCase):
    def test_cases_are_present(self) -> None:
        self.assertGreater(len(CASES), 5)

    def test_exact_key(self) -> None:
        for case in CASES:
            with self.subTest(input=case["input"]):
                self.assertEqual(ingest.exact_key(case["input"]), case["exact"])

    def test_translit_key(self) -> None:
        for case in CASES:
            with self.subTest(input=case["input"]):
                self.assertEqual(ingest.translit_key(case["input"]), case["translit"])

    def test_strip_key(self) -> None:
        for case in CASES:
            with self.subTest(input=case["input"]):
                self.assertEqual(ingest.strip_key(case["input"]), case["strip"])

    def test_every_headword_gets_three_keys(self) -> None:
        # iter_keys yields one key per kind so that query-time lookups are symmetric
        kinds = {kind for kind, _key in ingest.iter_keys("Fuß")}
        self.assertEqual(kinds, {0, 1, 2})


class EnglishKeyTests(unittest.TestCase):
    """Reverse (English -> German) search keys taken from the glosses."""

    def test_content_words_only(self) -> None:
        self.assertEqual(ingest.english_tokens("to go, to walk"), ["go", "walk"])
        self.assertEqual(
            ingest.english_tokens("house, building in which people live"),
            ["house", "building", "people", "live"],
        )

    def test_qualifiers_are_not_translations(self) -> None:
        self.assertEqual(ingest.english_tokens("(of a person) tall"), ["tall"])
        self.assertEqual(ingest.english_tokens("[figuratively] to give something"), ["give"])

    def test_main_translations_survive_the_stopword_list(self) -> None:
        self.assertEqual(ingest.english_tokens("to be"), ["be"])  # sein
        self.assertEqual(ingest.english_tokens("I"), ["i"])  # ich
        self.assertEqual(ingest.english_tokens("not"), ["not"])  # nicht

    def test_possessive_placeholders_are_dropped(self) -> None:
        self.assertEqual(ingest.english_tokens("someone's turn"), ["turn"])

    def test_glosses_that_describe_the_word_are_not_indexed(self) -> None:
        for gloss in (
            "alternative spelling of Haus",
            "(dated) nonstandard spelling of schon",
            "plural of Haus",
            "obsolete form of Haus",
            "genitive singular of Mann",
        ):
            with self.subTest(gloss=gloss):
                self.assertEqual(ingest.english_tokens(gloss), [])
        # a translation that merely contains one of those words stays indexed
        self.assertEqual(ingest.english_tokens("form of address"), ["form", "address"])
        self.assertEqual(ingest.english_tokens("spelling bee"), ["spelling", "bee"])

    def test_headline_words_are_flagged(self) -> None:
        senses = [
            {"glosses": ["to go", "to walk", "to run", "to move on"]},
            {"glosses": ["to function", "to work"]},
        ]
        keys = dict(ingest.english_keys(senses))
        self.assertEqual(keys["go"], 1)
        self.assertEqual(keys["run"], 1)
        self.assertEqual(keys["move"], 0)  # 4th gloss of the first sense
        self.assertEqual(keys["function"], 0)  # second sense

    def test_per_entry_cap_keeps_headline_words(self) -> None:
        many = ", ".join(f"word{chr(97 + i % 26)}{chr(97 + i // 26)}" for i in range(200))
        senses = [{"glosses": ["alpha", "beta"]}, {"glosses": [many]}]
        keys = dict(ingest.english_keys(senses))
        self.assertLessEqual(len(keys), ingest.MAX_ENGLISH_KEYS)
        self.assertEqual((keys["alpha"], keys["beta"]), (1, 1))

    def test_kind_name(self) -> None:
        self.assertEqual(ingest.KIND_NAMES[ingest.KIND_ENGLISH], "english")
        self.assertEqual(ingest.KIND_ENGLISH, 3)


if __name__ == "__main__":
    unittest.main()
