#!/usr/bin/env bash
# Start mappity. Settings come from .env (see .env.example). Works under bash and zsh.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env: it needs TYPESAFE_API_KEY and MAPILLARY_ACCESS_TOKEN." >&2; exit 1; }
[ -d node_modules ] || npm install

# Read the two values this script needs from .env without executing the file.
setting() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d "\"'\r"; }
PORT="${PORT:-$(setting PORT)}"; PORT="${PORT:-4321}"
NEEDLE_URL="${NEEDLE_URL:-$(setting NEEDLE_URL)}"; NEEDLE_URL="${NEEDLE_URL:-http://localhost:4007}"
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port $PORT. Is mappity running?" >&2
  exit 1
fi
curl -fsS -m 2 "$NEEDLE_URL/health" >/dev/null 2>&1 \
  || echo "Note: needle.server is not answering at $NEEDLE_URL. Wishes still work; 'near X' and 'take me to X' will not." >&2

exec npm start
