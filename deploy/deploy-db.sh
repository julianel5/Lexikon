#!/usr/bin/env bash
# Ship a rebuilt dictionary.db to the Railway API service's persistent volume.
#
# Prereqs: the Railway CLI installed (or npx as a fallback), logged in, an SSH key
# registered (`railway ssh keys add`), and the repository linked to the production
# API service:
#     railway link --project <project> --environment production --service api
#
# Usage (from the repository root):
#     bash deploy/deploy-db.sh [data/dictionary.db.gz]
#
# The script backs up the live database, uploads the compressed one, checks its
# integrity on the server before swapping, restarts the API and verifies that the
# new data is served. The backup is removed once the new database is verified.
set -euo pipefail

GZ="${1:-data/dictionary.db.gz}"
API_BASE="${API_BASE:-https://api.lexikon.moe}"
VERIFY_WORD="${VERIFY_WORD:-Arbeitszimmer}"
REMOTE_DIR="/data"
STAGED="${REMOTE_DIR}/dictionary.db.new.gz"
NEW="${REMOTE_DIR}/dictionary.db.new"
DB="${REMOTE_DIR}/dictionary.db"
BAK="${REMOTE_DIR}/dictionary.db.bak"

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

# On Windows Git Bash, stop MSYS from rewriting remote "/data/..." paths into C:\...
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# Use a global `railway` if present, otherwise fall back to npx.
if command -v railway >/dev/null 2>&1; then
  railway() { command railway "$@"; }
else
  railway() { npx --yes @railway/cli "$@"; }
fi

# Local interpreter for the verification step. On Windows `python3` may resolve to
# the Microsoft Store stub, which prints a message and fails, so require that the
# candidate actually runs before using it.
PYTHON=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import sys" >/dev/null 2>&1; then
    PYTHON="$(command -v "$cand")"
    break
  fi
done
[ -n "$PYTHON" ] || fail "python not found (needed to verify the deploy)"

[ -f "$GZ" ] || fail "compressed database not found: $GZ (build one with: gzip -k data/dictionary.db)"

say "1/7 Checking Railway auth and link"
railway whoami >/dev/null 2>&1 || fail "not logged in (run: railway login)"
railway status >/dev/null 2>&1 || fail "not linked to a project/service (run: railway link)"

say "2/7 Backing up the live database"
railway ssh -- cp "$DB" "$BAK" || fail "could not back up $DB (is the volume mounted at $REMOTE_DIR?)"

say "3/7 Uploading $(du -h "$GZ" | cut -f1) compressed database"
railway service files upload "$GZ" "$STAGED" --overwrite || fail "upload failed"

say "4/7 Decompressing and checking integrity on the server"
railway ssh -- sh -c "gzip -dc '$STAGED' > '$NEW' && python3 -c \"import sqlite3;print('integrity:',sqlite3.connect('$NEW').execute('PRAGMA integrity_check').fetchone()[0])\"" \
  || fail "decompress/integrity check failed"

say "5/7 Swapping in the new database"
railway ssh -- sh -c "rm -f '$DB-wal' '$DB-shm'; mv '$NEW' '$DB'; rm -f '$STAGED'" || fail "swap failed"

say "6/7 Restarting the API service"
# `railway service restart` issues the restart but then keeps the connection open
# (it never returns on its own), so it is wrapped in `timeout` where available
# (GNU coreutils; on macOS install gtimeout or restart from the dashboard). The
# verification below is the real check that the new database is loaded.
if command -v timeout >/dev/null 2>&1; then
  timeout 90 railway service restart --yes >/dev/null 2>&1 || true
else
  railway service restart --yes >/dev/null 2>&1 || true
fi

say "7/7 Verifying $VERIFY_WORD is served with components"
sleep 6
FOUND=$("$PYTHON" - "$API_BASE" "$VERIFY_WORD" <<'PY'
import json, sys, time, urllib.parse, urllib.request
api, word = sys.argv[1], sys.argv[2]
# The API sits behind Cloudflare, which caches GET /api/* responses. A throwaway query
# parameter makes each request a cache miss, so this reads the database that was just swapped in.
nocache = "_=" + str(time.time_ns())
def get(path):
    sep = "&" if "?" in path else "?"
    # Cloudflare answers 403 to urllib's default User-Agent, so send our own
    request = urllib.request.Request(api + path + sep + nocache, headers={"User-Agent": "lexikon-deploy-script"})
    return json.load(urllib.request.urlopen(request, timeout=20))
results = get("/api/suggest?limit=1&q=" + urllib.parse.quote(word)).get("results", [])
entry = get("/api/entry/" + str(results[0]["id"])) if results else {}
print("components:", entry.get("components"))
sys.exit(0 if entry.get("components") else 1)
PY
) || fail "verification failed — the service may still be starting; check: railway logs"

printf '%s\n' "$FOUND"
say "Removing the backup"
railway ssh -- rm -f "$BAK" || true
printf '\nDEPLOY OK\n'
printf 'Last step, by hand: Cloudflare dashboard > lexikon.moe > Caching > Configuration > Purge Everything,\n'
printf 'so visitors do not get answers cached from the previous database (up to 2 hours).\n'
