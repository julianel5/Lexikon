/**
 * German -> English dictionary API.
 *
 *   GET /api/health          -> { status, entries, searchKeys }
 *   GET /api/suggest?q=...   -> folded (exact/translit/strip) lookup, ranked
 *   GET /api/entry/:id       -> full entry JSON (data column)
 *   GET /api/sitemap.xml     -> sitemap index for search engines
 *   GET /api/sitemap/page/:n -> one page of entry URLs (XML)
 *
 * Read-only, CORS-enabled for the Vite dev server.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { autocomplete, entryCount, getEntry, sitemapPage, stats, suggest, textLookup } from "./db.js";
import { analyzeText, MAX_TEXT_LENGTH } from "./parse.js";
import { foldQuery } from "./fold.js";
import { SITEMAP_PAGE_SIZE, buildSitemapIndex, buildSitemapPage, sitemapPageCount } from "./sitemap.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : DEFAULT_ORIGINS;

const app = new Hono();

app.use("*", logger());

app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      configuredOrigins.includes("*") || configuredOrigins.includes(origin)
        ? origin
        : configuredOrigins[0]!,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

app.get("/", (c) =>
  c.json({
    name: "german-dict-api",
    endpoints: [
      "/api/health",
      "/api/suggest?q=",
      "/api/autocomplete?q=",
      "POST /api/parse",
      "/api/entry/:id",
      "/api/sitemap.xml",
      "/api/sitemap/page/:page",
    ],
  }),
);

app.get("/api/health", (c) => {
  // the path of the database is not part of the public answer
  const { entries, searchKeys, frequencyEntries } = stats();
  return c.json({ status: "ok", entries, searchKeys, frequencyEntries });
});

app.get("/api/suggest", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    return c.json({ error: "missing query parameter 'q'" }, 400);
  }
  const limitParam = Number(c.req.query("limit") ?? 25);
  const limit = Number.isFinite(limitParam) ? limitParam : 25;

  const outcome = suggest(q, limit);
  const folded = foldQuery(outcome.effectiveQuery);
  return c.json({
    query: q,
    resolvedQuery: outcome.effectiveQuery,
    reflexFallback: outcome.reflexFallback,
    folded: { exact: folded.exact, translit: folded.translit, strip: folded.strip },
    count: outcome.results.length,
    results: outcome.results,
  });
});

app.get("/api/autocomplete", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    return c.json({ query: q, suggestions: [] });
  }
  const limitParam = Number(c.req.query("limit") ?? 8);
  const limit = Number.isFinite(limitParam) ? limitParam : 8;
  return c.json({ query: q, suggestions: autocomplete(q, limit) });
});

// Cut a text into words and resolve each one to its dictionary entries (lemmas, compounds).
app.post("/api/parse", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON: { \"text\": string }" }, 400);
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    return c.json({ error: "missing string field 'text'" }, 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return c.json({ error: "text too long", maxLength: MAX_TEXT_LENGTH }, 413);
  }
  return c.json(analyzeText(text, textLookup));
});

app.get("/api/entry/:id", (c) => {
  const raw = c.req.param("id");
  if (!/^\d+$/.test(raw)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const entry = getEntry(Number(raw));
  if (!entry) {
    return c.json({ error: "entry not found", id: Number(raw) }, 404);
  }
  return c.json(entry);
});

// Sitemaps for search engines (robots.txt points at them). The site is a single-page app: an
// entry page only exists as data, so it is listed straight from the database, at most 50,000
// URLs per file, which is the limit of the sitemap protocol.
app.get("/api/sitemap.xml", (c) =>
  c.body(buildSitemapIndex(sitemapPageCount(entryCount())), 200, {
    "Content-Type": "application/xml; charset=utf-8",
  }),
);

app.get("/api/sitemap/page/:page", (c) => {
  const raw = c.req.param("page");
  if (!/^\d+$/.test(raw)) {
    return c.json({ error: "page must be a non-negative integer" }, 400);
  }
  const page = Number(raw);
  // The range is checked before multiplying, so a huge number can never become a huge OFFSET.
  if (page >= sitemapPageCount(entryCount())) {
    return c.json({ error: "page not found", page }, 404);
  }
  const entries = sitemapPage(SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE);
  return c.body(buildSitemapPage(entries), 200, {
    "Content-Type": "application/xml; charset=utf-8",
  });
});

app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: "internal server error" }, 500);
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  const { entries, searchKeys, dbPath } = stats();
  console.log(`german-dict-api listening on http://localhost:${info.port}`);
  console.log(`  db        : ${dbPath}`);
  console.log(`  entries   : ${entries.toLocaleString()}`);
  console.log(`  searchKeys: ${searchKeys.toLocaleString()}`);
  console.log(`  cors      : ${configuredOrigins.join(", ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
