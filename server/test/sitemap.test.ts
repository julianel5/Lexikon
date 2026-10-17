/**
 * A malformed sitemap is ignored by search engines without any error on our
 * side, and the listed URLs must be the ones the web app really serves
 * (web/src/lib/route.ts, buildPath) or they lead to a page that re-resolves
 * by word. Both are pure string building, so they are tested without a
 * database: the SQL that slices the pages lives in db.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  API_ORIGIN,
  SITE_ORIGIN,
  SITEMAP_PAGE_SIZE,
  buildSitemapIndex,
  buildSitemapPage,
  entryUrl,
  sitemapPageCount,
} from "../src/sitemap.js";

describe("sitemapPageCount", () => {
  it("needs one file for anything up to a full page", () => {
    assert.equal(sitemapPageCount(0), 1);
    assert.equal(sitemapPageCount(1), 1);
    assert.equal(sitemapPageCount(SITEMAP_PAGE_SIZE), 1);
  });

  it("adds a file past the 50,000 URL limit", () => {
    assert.equal(sitemapPageCount(SITEMAP_PAGE_SIZE + 1), 2);
    assert.equal(sitemapPageCount(102_740), 3);
  });
});

describe("entryUrl", () => {
  it("builds the same URL as the web app", () => {
    assert.equal(
      entryUrl({ id: 34, word: "Haus" }),
      `${SITE_ORIGIN}/entry/34/Haus`,
    );
  });

  it("encodes umlauts, eszett, spaces and slashes so the path stays valid", () => {
    assert.equal(
      entryUrl({ id: 1, word: "Fußgängerüberweg" }),
      `${SITE_ORIGIN}/entry/1/Fu%C3%9Fg%C3%A4nger%C3%BCberweg`,
    );
    assert.equal(
      entryUrl({ id: 2, word: "Rat des Ältesten" }),
      `${SITE_ORIGIN}/entry/2/Rat%20des%20%C3%84ltesten`,
    );
    assert.equal(
      entryUrl({ id: 3, word: "und/oder" }),
      `${SITE_ORIGIN}/entry/3/und%2Foder`,
    );
  });
});

describe("buildSitemapPage", () => {
  it("is a urlset with one url per entry", () => {
    const xml = buildSitemapPage([
      { id: 34, word: "Haus" },
      { id: 6737, word: "schleißen" },
    ]);
    const lines = xml.split("\n");
    assert.equal(lines[0], '<?xml version="1.0" encoding="UTF-8"?>');
    assert.equal(
      lines[1],
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    assert.equal(lines[2], `<url><loc>${SITE_ORIGIN}/entry/34/Haus</loc></url>`);
    assert.equal(
      lines[3],
      `<url><loc>${SITE_ORIGIN}/entry/6737/schlei%C3%9Fen</loc></url>`,
    );
    assert.equal(lines[lines.length - 1], "</urlset>");
  });

  it("escapes what encodeURIComponent leaves behind, e.g. an apostrophe", () => {
    const xml = buildSitemapPage([{ id: 5, word: "geht's" }]);
    assert.ok(
      xml.includes(`<loc>${SITE_ORIGIN}/entry/5/geht&apos;s</loc>`),
      `unexpected escaping in: ${xml}`,
    );
    assert.ok(!/<loc>[^<]*&(?!amp;|apos;|quot;|lt;|gt;)/.test(xml), "raw & left");
  });

  it("stays well-formed when there is nothing to list", () => {
    assert.equal(
      buildSitemapPage([]),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "</urlset>",
    );
  });
});

describe("buildSitemapIndex", () => {
  it("lists every page for the crawler, in order", () => {
    const xml = buildSitemapIndex(3);
    assert.equal(
      xml.split("\n")[1],
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    assert.equal(xml.split("<sitemap>").length - 1, 3);
    for (let page = 0; page < 3; page++) {
      assert.ok(
        xml.includes(
          `<sitemap><loc>${API_ORIGIN}/api/sitemap/page/${page}</loc></sitemap>`,
        ),
        `missing page ${page}`,
      );
    }
    assert.equal(xml.split("\n")[xml.split("\n").length - 1], "</sitemapindex>");
  });
});
