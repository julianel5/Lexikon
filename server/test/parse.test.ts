import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeText,
  decompose,
  rankCandidates,
  tokenize,
  type Lookup,
  type RawCandidate,
} from "../src/parse.js";

const entry = (
  id: number,
  word: string,
  pos: string,
  headword: number,
  weight = 1000,
  article: string | null = null,
): RawCandidate => ({ id, word, pos, article, gloss: `gloss of ${word}`, headword, weight });

/** A tiny in-memory dictionary. */
function fakeLookup(): Lookup {
  const byKey = new Map<string, RawCandidate[]>([
    ["gehen", [entry(1, "gehen", "verb", 1)]],
    ["ging", [entry(1, "gehen", "verb", 0)]],
    ["haus", [entry(2, "Haus", "noun", 1, 800, "das")]],
    ["häusern", [entry(2, "Haus", "noun", 0, 800, "das")]],
    ["essen", [entry(3, "Essen", "noun", 1, 500, "das"), entry(4, "essen", "verb", 1, 900)]],
    ["ich", [entry(5, "ich", "pron", 1)]],
    ["nach", [entry(6, "nach", "prep", 1)]],
  ]);
  const heads = new Map<string, RawCandidate>([
    ["wasser", entry(10, "Wasser", "noun", 1, 900, "das")],
    ["flasche", entry(11, "Flasche", "noun", 1, 700, "die")],
    ["bund", entry(12, "Bund", "noun", 1)],
    ["land", entry(13, "Land", "noun", 1)],
    ["schreiben", entry(14, "schreiben", "verb", 1)],
    ["tisch", entry(15, "Tisch", "noun", 1)],
    ["deckel", entry(16, "Deckel", "noun", 1)],
    ["ost", entry(17, "Ost", "noun", 1)],
    ["west", entry(18, "West", "noun", 1)],
  ]);
  return {
    candidates: (key) => byKey.get(key) ?? [],
    headword: (key) => {
      const e = heads.get(key);
      return e
        ? { id: e.id, word: e.word, pos: e.pos, article: e.article, gloss: e.gloss }
        : null;
    },
  };
}

describe("tokenize", () => {
  it("covers the whole text, words and separators", () => {
    const text = "Ich ging nach Hause. E-Mail, geht’s!";
    const tokens = tokenize(text);
    assert.equal(tokens.map((t) => t.text).join(""), text);
    assert.deepEqual(
      tokens.filter((t) => t.word).map((t) => t.text),
      ["Ich", "ging", "nach", "Hause", "E-Mail", "geht’s"],
    );
    for (const t of tokens) assert.equal(text.slice(t.start, t.end), t.text);
  });

  it("keeps umlauts and ß inside words and ignores digits", () => {
    const words = tokenize("Straße 12 über Mädchen").filter((t) => t.word).map((t) => t.text);
    assert.deepEqual(words, ["Straße", "über", "Mädchen"]);
  });

  it("handles empty and separator-only text", () => {
    assert.deepEqual(tokenize(""), []);
    assert.equal(tokenize("... !?").filter((t) => t.word).length, 0);
  });
});

describe("rankCandidates", () => {
  const essen = [entry(3, "Essen", "noun", 1, 500), entry(4, "essen", "verb", 1, 900)];

  it("prefers a noun for a capitalised word inside a sentence", () => {
    assert.equal(rankCandidates(essen, "Essen", false)[0]!.word, "Essen");
  });

  it("prefers the verb for a lower-case word", () => {
    assert.equal(rankCandidates(essen, "essen", false)[0]!.word, "essen");
  });

  it("does not trust a capital at the start of a sentence", () => {
    assert.equal(rankCandidates(essen, "Essen", true)[0]!.word, "essen"); // heavier entry wins
  });

  it("marks inflected forms and prefers a headword of equal weight", () => {
    const ranked = rankCandidates(
      [entry(1, "gehen", "verb", 0, 1000), entry(9, "ging", "verb", 1, 1000)],
      "ging",
      false,
    );
    assert.equal(ranked.find((c) => c.word === "gehen")!.viaForm, true);
    assert.equal(ranked[0]!.word, "ging");
  });

  it("does not let a rarely used alternative-form entry beat the real lemma", () => {
    const alt: RawCandidate = { ...entry(7, "mir", "pron", 1, 1500), gloss: "alternative form of wir" };
    const real: RawCandidate = { ...entry(8, "ich", "pron", 0, 1400), gloss: "I (first person singular)" };
    assert.equal(rankCandidates([alt, real], "mir", false)[0]!.word, "ich");
  });

  it("weighs a well documented lemma above an obscure headword", () => {
    const ranked = rankCandidates(
      [entry(20, "einen", "verb", 1, 200), entry(21, "ein", "article", 0, 4000)],
      "eine",
      false,
    );
    assert.equal(ranked[0]!.word, "ein");
  });

  it("returns at most five candidates", () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(i, `w${i}`, "noun", 1));
    assert.equal(rankCandidates(many, "w", false).length, 5);
  });

  it("lets a function word beat a rare verb form (die -> der, not a verb)", () => {
    const ranked = rankCandidates(
      [entry(30, "dienen", "verb", 0, 3000), entry(31, "der", "article", 0, 1500)],
      "die",
      false,
    );
    assert.equal(ranked[0]!.word, "der");
  });

  it("does not explain a lower-case word with an all-capitals abbreviation", () => {
    const ranked = rankCandidates(
      [entry(40, "IM", "noun", 1, 900), entry(41, "im", "contraction", 1, 300)],
      "im",
      false,
    );
    assert.equal(ranked[0]!.word, "im");
  });

  it("prefers the lower-case lemma for a capitalised first word of a sentence", () => {
    const ranked = rankCandidates(
      [entry(50, "Ich", "noun", 1, 1500), entry(51, "ich", "pron", 1, 1400)],
      "Ich",
      true,
    );
    assert.equal(ranked[0]!.word, "ich");
  });
});

describe("decompose", () => {
  const lookup = fakeLookup();

  it("splits a simple compound", () => {
    const parts = decompose("wasserflasche", lookup)!;
    assert.deepEqual(parts.map((p) => p.word), ["Wasser", "Flasche"]);
  });

  it("drops a linking element (Bundesland -> Bund + Land)", () => {
    const parts = decompose("bundesland", lookup)!;
    assert.deepEqual(parts.map((p) => p.word), ["Bund", "Land"]);
  });

  it("completes a verb stem (Schreibtisch -> schreiben + Tisch)", () => {
    const parts = decompose("schreibtisch", lookup)!;
    assert.deepEqual(parts.map((p) => p.word), ["schreiben", "Tisch"]);
  });

  it("splits three-part compounds, also with a linking element", () => {
    for (const word of ["wasserflaschedeckel", "wasserflaschendeckel"]) {
      const parts = decompose(word, lookup)!;
      assert.deepEqual(parts.map((p) => p.word), ["Wasser", "Flasche", "Deckel"], word);
    }
  });

  it("returns null when no split exists", () => {
    assert.equal(decompose("xyzqwerty", lookup), null);
    assert.equal(decompose("ab", lookup), null);
  });
});

describe("analyzeText", () => {
  const lookup = fakeLookup();

  it("resolves inflected forms to their lemma", () => {
    const { tokens, stats } = analyzeText("Ich ging nach Häusern.", lookup);
    const ging = tokens.find((t) => t.text === "ging")!;
    assert.equal(ging.candidates![0]!.word, "gehen");
    assert.equal(ging.candidates![0]!.viaForm, true);
    const hausern = tokens.find((t) => t.text === "Häusern")!;
    assert.equal(hausern.candidates![0]!.word, "Haus");
    assert.deepEqual(stats, { words: 4, unique: 4, unknown: 0 });
  });

  it("falls back to a compound split and counts unknown words", () => {
    const { tokens, stats } = analyzeText("Die Wasserflasche und xyzqwerty", lookup);
    const compound = tokens.find((t) => t.text === "Wasserflasche")!;
    assert.deepEqual(compound.compound!.map((p) => p.word), ["Wasser", "Flasche"]);
    assert.equal(compound.candidates, undefined);
    const unknown = tokens.find((t) => t.text === "xyzqwerty")!;
    assert.equal(unknown.candidates, undefined);
    assert.equal(unknown.compound, undefined);
    assert.equal(stats.unknown, 3); // "Die" and "und" are not in the fake dictionary either
  });

  it("splits hyphenated words into their known parts", () => {
    const { tokens } = analyzeText("Ost-West", lookup);
    assert.deepEqual(tokens[0]!.compound!.map((p) => p.word), ["Ost", "West"]);
  });

  it("uses the position in the sentence for capitalised ambiguous words", () => {
    const mid = analyzeText("Ich Essen", lookup).tokens.find((t) => t.text === "Essen")!;
    assert.equal(mid.candidates![0]!.word, "Essen"); // noun
    const start = analyzeText("Essen", lookup).tokens[0]!;
    assert.equal(start.candidates![0]!.word, "essen"); // verb: heavier entry
  });

  it("returns an empty analysis for empty text", () => {
    assert.deepEqual(analyzeText("", lookup), { tokens: [], stats: { words: 0, unique: 0, unknown: 0 } });
  });
});
