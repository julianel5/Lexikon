"""Word-frequency tests (``--freq``): reading a word list and counting it per entry.

Run from the repository root:  python -m unittest discover -s ingest -p "test_*.py"
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

import ingest

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_DUMP = FIXTURES / "sample.jsonl"
SAMPLE_FREQ = FIXTURES / "freq_sample.txt"


class LoadFrequenciesTests(unittest.TestCase):
    def test_reads_a_leipzig_word_list(self) -> None:
        counts = ingest.load_frequencies(SAMPLE_FREQ)
        self.assertEqual(counts["Haus"], 3000)
        self.assertEqual(counts["schön"], 2000)
        # case is kept: German nouns are capitalised
        self.assertEqual(counts["Schon"], 400)
        self.assertEqual(counts["schon"], 5000)

    def test_drops_punctuation_numbers_and_urls(self) -> None:
        counts = ingest.load_frequencies(SAMPLE_FREQ)
        for noise in (".", "2024", "www.haus.de"):
            self.assertNotIn(noise, counts)

    def test_reads_a_yomitan_frequency_zip(self) -> None:
        rows = [
            ["der", "freq", {"value": 4, "displayValue": "4 (322519)"}],
            ["Haus", "freq", {"value": 900, "displayValue": "900 (3719)"}],
            [",", "freq", {"value": 2, "displayValue": "2 (687013)"}],
            ["ohne", "freq", {"value": 7}],  # no count: skipped
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "list.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("index.json", json.dumps({"title": "x"}))
                archive.writestr("term_meta_bank_1.json", json.dumps(rows))
            counts = ingest.load_frequencies(path)
        self.assertEqual(counts, {"der": 322519, "Haus": 3719})

    def test_rejects_a_file_without_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.txt"
            path.write_text("not a word list\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                ingest.load_frequencies(path)


class ComputeFrequenciesTests(unittest.TestCase):
    def test_adds_up_the_forms_of_an_entry(self) -> None:
        counts = {"Haus": 10, "Häuser": 5, "Hauses": 1}
        # (id, owned spellings, spellings only listed in the table of forms)
        result = ingest.compute_frequencies([(1, ["Haus", "Häuser"], ["Hauses"])], counts)
        self.assertEqual(result, {1: 16})

    def test_a_spelling_with_its_own_page_is_not_given_to_entries_that_list_it(self) -> None:
        # "ich" lists the whole pronoun table, but "mir" has a page of its own
        counts = {"ich": 50, "mir": 100}
        result = ingest.compute_frequencies(
            [(1, ["ich"], ["mir"]), (2, ["mir"], [])], counts
        )
        self.assertEqual(result, {1: 50, 2: 100})

    def test_a_redirected_form_page_counts_for_its_lemma_only(self) -> None:
        # "die" is a form page of the article; a name lists it in its table
        counts = {"die": 90, "Algarve": 3}
        result = ingest.compute_frequencies(
            [(1, ["der", "die"], []), (2, ["Algarve"], ["die"])], counts
        )
        self.assertEqual(result, {1: 90, 2: 3})

    def test_a_spelling_nobody_owns_is_split_between_the_entries_that_list_it(self) -> None:
        result = ingest.compute_frequencies(
            [(1, ["gehen"], ["ging"]), (2, ["gehen2"], ["ging"])], {"ging": 10}
        )
        self.assertEqual(result, {1: 5, 2: 5})

    def test_homographs_share_the_count_of_their_common_spelling(self) -> None:
        result = ingest.compute_frequencies([(1, ["Band"], []), (2, ["Band"], [])], {"Band": 7})
        self.assertEqual(result, {1: 4, 2: 4})  # 3.5 each, rounded

    def test_a_form_listed_twice_by_one_entry_counts_once(self) -> None:
        result = ingest.compute_frequencies([(1, ["Haus"], ["Haus", "Haus"])], {"Haus": 7})
        self.assertEqual(result, {1: 7})

    def test_lower_case_words_also_count_their_capitalised_spelling(self) -> None:
        counts = {"ich": 10, "Ich": 4}
        self.assertEqual(ingest.compute_frequencies([(1, ["ich"], [])], counts), {1: 14})

    def test_a_capitalised_spelling_far_more_frequent_than_the_lower_case_one_is_another_word(self) -> None:
        # "haus" (imperative of "hausen") is rare; "Haus" is the noun
        counts = {"haus": 21, "Haus": 3719}
        self.assertEqual(ingest.compute_frequencies([(1, ["haus"], [])], counts), {1: 21})

    def test_an_interjection_counts_its_capitalised_spelling_without_the_limit(self) -> None:
        # "Hallo" opens the sentence far more often than "hallo" appears inside one
        counts = {"hallo": 47, "Hallo": 1223}
        entries = [(1, ["hallo"], [], True)]
        self.assertEqual(ingest.compute_frequencies(entries, counts), {1: 1270})
        # the same counts for a non-interjection keep the limit
        self.assertEqual(ingest.compute_frequencies([(1, ["hallo"], [])], counts), {1: 47})

    def test_a_capitalised_spelling_alone_is_not_counted_for_a_lower_case_word(self) -> None:
        self.assertEqual(ingest.compute_frequencies([(1, ["haus"], [])], {"Haus": 100}), {})

    def test_a_sentence_start_capital_is_counted_up_to_the_ratio(self) -> None:
        counts = {"heute": 100, "Heute": 300}  # exactly 3 times: counted
        self.assertEqual(ingest.compute_frequencies([(1, ["heute"], [])], counts), {1: 400})
        counts = {"heute": 100, "Heute": 301}
        self.assertEqual(ingest.compute_frequencies([(1, ["heute"], [])], counts), {1: 100})

    def test_nouns_do_not_count_their_lower_case_spelling(self) -> None:
        counts = {"Haus": 10, "haus": 3}
        self.assertEqual(ingest.compute_frequencies([(1, ["Haus"], [])], counts), {1: 10})

    def test_entries_without_counts_are_left_out(self) -> None:
        self.assertEqual(ingest.compute_frequencies([(1, ["Xyz"], [])], {"Haus": 1}), {})

    def test_spellings_are_matched_in_nfc(self) -> None:
        decomposed = "Füße"  # Füße with a combining diaeresis
        result = ingest.compute_frequencies([(1, [decomposed], [])], {"Füße": 9})
        self.assertEqual(result, {1: 9})


class BuildDatabaseTests(unittest.TestCase):
    def build(self, frequencies):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = Path(tmp.name) / "check.db"
        ingest.run(SAMPLE_DUMP, out, 100, frequencies)
        conn = sqlite3.connect(out)
        self.addCleanup(conn.close)
        return conn

    def test_without_a_list_every_entry_has_no_frequency(self) -> None:
        conn = self.build(None)
        rows = conn.execute("SELECT freq, freq_rank FROM entries").fetchall()
        self.assertTrue(rows)
        self.assertTrue(all(row == (0, 0) for row in rows))

    def test_entries_get_the_count_of_their_forms_and_a_rank(self) -> None:
        conn = self.build(ingest.load_frequencies(SAMPLE_FREQ))
        by_word = {
            word: (freq, rank)
            for word, freq, rank in conn.execute("SELECT word, freq, freq_rank FROM entries")
        }
        # Haus + Hauses + Häuser + Häusern (Häuser also comes from a redirected form page)
        self.assertEqual(by_word["Haus"], (3540, 2))
        # schön + schöner + schönste + schöne (a redirected page) + Schön (sentence start)
        self.assertEqual(by_word["schön"], (2880, 3))
        # schon + Schon
        self.assertEqual(by_word["schon"], (5400, 1))

    def test_ranks_follow_the_counts_without_gaps(self) -> None:
        conn = self.build(ingest.load_frequencies(SAMPLE_FREQ))
        rows = conn.execute(
            "SELECT freq, freq_rank FROM entries WHERE freq > 0 ORDER BY freq_rank"
        ).fetchall()
        self.assertEqual([rank for _, rank in rows], list(range(1, len(rows) + 1)))
        self.assertEqual([freq for freq, _ in rows], sorted((f for f, _ in rows), reverse=True))

    def test_autocomplete_carries_the_frequency(self) -> None:
        conn = self.build(ingest.load_frequencies(SAMPLE_FREQ))
        freq = conn.execute(
            "SELECT freq FROM autocomplete WHERE word = 'Haus' LIMIT 1"
        ).fetchone()
        self.assertEqual(freq, (3540,))


if __name__ == "__main__":
    unittest.main()
