# syntax=docker/dockerfile:1
# Build context: repository root (needs both server/ and ingest/).
FROM node:25-bookworm-slim

# python3: runs ingest/ingest.py at build time; make/g++: fallback if
# better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server ./server
COPY ingest ./ingest

# The dictionary DB is a build artifact. Defaults to the small sample;
# override with --build-arg DICT_SOURCE=<path to a kaikki.org JSONL dump>.
ARG DICT_SOURCE=ingest/fixtures/sample.jsonl
RUN mkdir -p data && python3 ingest/ingest.py "$DICT_SOURCE" -o data/dictionary.db

ENV DB_PATH=/app/data/dictionary.db \
    HOST=0.0.0.0
EXPOSE 3000

WORKDIR /app/server
CMD ["npm", "start"]
