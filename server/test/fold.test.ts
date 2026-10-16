/**
 * Search-key folding must match ingest/ingest.py byte for byte, or lookups
 * silently miss. Both sides are checked against the same expected values in
 * ingest/fixtures/fold_cases.json (the Python side is ingest/test_fold.py).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { englishWords, queryEnglishWords } from "../src/english.js";
import {
  KIND_ENGLISH,
  exactKey,
  foldQuery,
  kindName,
  stripKey,
  translitKey,
} from "../src/fold.js";

interface Case {
  input: string;
  exact: string;
  translit: string;
  strip: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES: Case[] = JSON.parse(
  readFileSync(
    path.resolve(HERE, "..", "..", "ingest", "fixtures", "fold_cases.json"),
    "utf-8",
  ),
);

interface EnglishCase {
  input: string;
  tokens: string[];
}

const ENGLISH_CASES: EnglishCase[] = JSON.parse(
  readFileSync(
    path.resolve(HERE, "..", "..", "ingest", "fixtures", "english_cases.json"),
    "utf-8",
  ),
);

describe("english query tokenisation", () => {
  for (const c of ENGLISH_CASES) {
    it(`cuts ${JSON.stringify(c.input)} like the ingest`, () => {
      assert.deepEqual(englishWords(c.input), c.tokens);
    });
  }

  it("looks up the distinct words of a query", () => {
    assert.deepEqual(queryEnglishWords("hot water"), ["hot", "water"]);
    assert.deepEqual(queryEnglishWords("water water"), ["water"]);
    assert.deepEqual(queryEnglishWords("to go"), ["go"]);
  });

  it("caps the number of looked-up words", () => {
    assert.equal(queryEnglishWords("one two three four five six seven eight").length, 5);
  });

  it("does not cut a query with non-ASCII letters (a German word)", () => {
    assert.deepEqual(queryEnglishWords("schön"), []);
    assert.deepEqual(queryEnglishWords("große Stadt"), []);
  });
});

describe("search-key folding", () => {
  it("has cases", () => {
    assert.ok(CASES.length > 5);
  });

  for (const c of CASES) {
    it(`folds ${JSON.stringify(c.input)} like the ingest`, () => {
      assert.equal(exactKey(c.input), c.exact);
      assert.equal(translitKey(c.input), c.translit);
      assert.equal(stripKey(c.input), c.strip);
    });
  }

  it("foldQuery returns the three keys", () => {
    const folded = foldQuery("Fuß");
    assert.equal(folded.exact, "fuß");
    assert.equal(folded.translit, "fuss");
    assert.equal(folded.strip, "fus");
  });

  it("names the reverse-search kind", () => {
    assert.equal(KIND_ENGLISH, 3);
    assert.equal(kindName(KIND_ENGLISH), "english");
  });
});
