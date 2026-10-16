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

    def test_relevance_scores(self) -> None:
        senses = [
            {"glosses": ["to go", "to walk forward", "to run", "to wander about", "a small house, shed"]},
            {"glosses": ["to function", "to work", "free of water, dry"]},
        ]
        keys = dict(ingest.english_keys(senses))
        # a whole translation of the first sense is the best match...
        self.assertEqual(keys["go"], ingest.SCORE_WHOLE_FIRST_SENSE)
        self.assertEqual(keys["forward"], ingest.SCORE_HEADLINE)  # 2nd gloss, a phrase
        self.assertEqual(keys["wander"], ingest.SCORE_MENTION)  # 4th gloss, a phrase
        # ...a whole translation of a later sense is next...
        self.assertEqual(keys["function"], ingest.SCORE_WHOLE_LATER_SENSE)
        self.assertEqual(keys["dry"], ingest.SCORE_WHOLE_LATER_SENSE)  # comma-separated part
        # ...then words of the headline glosses, then mentions further down
        self.assertEqual(keys["small"], ingest.SCORE_MENTION)  # 5th gloss, in a phrase
        self.assertEqual(keys["water"], ingest.SCORE_MENTION)
        self.assertEqual(keys["shed"], ingest.SCORE_WHOLE_FIRST_SENSE)

    def test_separators_inside_qualifiers_do_not_split_a_gloss(self) -> None:
        senses = [
            {
                "glosses": [
                    "book (collection of sheets of paper bound together; long work fit for publication)",
                    "to ruin, to deface (e.g. the look of a person, landscape, city, etc.)",
                ]
            }
        ]
        keys = dict(ingest.english_keys(senses))
        self.assertEqual(keys["book"], ingest.SCORE_WHOLE_FIRST_SENSE)
        self.assertEqual(keys["ruin"], ingest.SCORE_WHOLE_FIRST_SENSE)
        self.assertEqual(keys["deface"], ingest.SCORE_WHOLE_FIRST_SENSE)
        # words that only appear inside the qualifier are not translations
        for word in ("city", "landscape", "paper", "publication", "person"):
            self.assertNotIn(word, keys)

    def test_scores_order_as_documented(self) -> None:
        self.assertGreater(ingest.SCORE_WHOLE_FIRST_SENSE, ingest.SCORE_WHOLE_LATER_SENSE)
        self.assertGreater(ingest.SCORE_WHOLE_LATER_SENSE, ingest.SCORE_HEADLINE)
        self.assertGreater(ingest.SCORE_HEADLINE, ingest.SCORE_MENTION)
        self.assertGreater(ingest.SCORE_MENTION, 0)

    def test_per_entry_cap_keeps_headline_words(self) -> None:
        many = ", ".join(f"word{chr(97 + i % 26)}{chr(97 + i // 26)}" for i in range(200))
        senses = [{"glosses": ["alpha", "beta"]}, {"glosses": [many]}]
        keys = dict(ingest.english_keys(senses))
        self.assertLessEqual(len(keys), ingest.MAX_ENGLISH_KEYS)
        self.assertEqual(
            (keys["alpha"], keys["beta"]),
            (ingest.SCORE_WHOLE_FIRST_SENSE, ingest.SCORE_WHOLE_FIRST_SENSE),
        )

    def test_kind_name(self) -> None:
        self.assertEqual(ingest.KIND_NAMES[ingest.KIND_ENGLISH], "english")
        self.assertEqual(ingest.KIND_ENGLISH, 3)


if __name__ == "__main__":
    unittest.main()
