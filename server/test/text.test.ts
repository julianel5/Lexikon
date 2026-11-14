import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripInvisible } from "../src/text.js";

describe("stripInvisible", () => {
  it("removes the soft hyphens a word copied from Duden carries", () => {
    assert.equal(stripInvisible("Mord\u00adpro\u00adzess"), "Mordprozess");
  });

  it("removes zero-width spaces, joiners, the word joiner and a byte-order mark", () => {
    assert.equal(stripInvisible("\ufeffHaus\u200b\u200c\u200d\u2060tür"), "Haustür");
  });

  it("keeps visible hyphens, spaces and umlauts", () => {
    assert.equal(stripInvisible("E-Mail für Straße"), "E-Mail für Straße");
  });
});
