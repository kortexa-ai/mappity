#!/usr/bin/env bash
# Start mappity. Settings come from .env (see .env.example). Works under bash and zsh.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env: it needs MAPILLARY_ACCESS_TOKEN and, for the hosted judge, TYPESAFE_API_KEY (see .env.example)." >&2; exit 1; }
[ -d node_modules ] || npm install

# Use the same dotenv parser and environment precedence as npm start. Missing optional
# values return an empty string successfully; .env contents are never executed as shell code.
setting() { node --env-file=.env -e 'process.stdout.write(process.env[process.argv[1]] || "")' "$1"; }
PORT="${PORT:-$(setting PORT)}"; PORT="${PORT:-4321}"
JEV_PROVIDER="${JEV_PROVIDER:-$(setting JEV_PROVIDER)}"; JEV_PROVIDER="${JEV_PROVIDER:-jev}"
SHINGI_URL="${SHINGI_URL:-$(setting SHINGI_URL)}"; SHINGI_URL="${SHINGI_URL:-http://192.168.2.3:2068}"
NEEDLE_URL="${NEEDLE_URL:-$(setting NEEDLE_URL)}"; NEEDLE_URL="${NEEDLE_URL:-http://localhost:4007}"
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port $PORT. Is mappity running?" >&2
  exit 1
fi
curl -fsS -m 2 "$NEEDLE_URL/health" >/dev/null 2>&1 \
  || echo "Note: needle.server is not answering at $NEEDLE_URL. Wishes still work; 'near X' and 'take me to X' will not." >&2
if [ "$JEV_PROVIDER" = "shingi" ]; then
  curl -fsS -m 2 "${SHINGI_URL%/}/v1/models" >/dev/null 2>&1 \
    || echo "Note: Shingi is not answering at $SHINGI_URL (JEV_PROVIDER=shingi). Every question will fail until it is." >&2
fi

exec npm start
