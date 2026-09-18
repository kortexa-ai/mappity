#!/bin/bash
# usage: ask.sh "text"  -> prints a compact summary of each pipeline event
BODY="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "view": {"center": [-122.3421, 47.6097], "bbox": [-122.3520, 47.6040, -122.3320, 47.6150], "zoom": 15}}))' "$1")"
curl -sS -N -X POST "${MAPPITY_URL:-http://localhost:${PORT:-4321}}/api/ask" -H 'Content-Type: application/json' -d "$BODY" | python3 "$(dirname "$0")/summarize.py"
