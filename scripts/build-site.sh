#!/usr/bin/env bash
# Builds the static site that GitHub Pages serves: the landing page, the real client playing back
# recorded answers under app/, and the demo film. Works under bash and zsh.
#   scripts/build-site.sh [output directory inside the repository, default _site]
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-_site}"
case "$OUT" in
  /* | *..* | "" | .) echo "The output directory must be a plain path inside the repository: $OUT" >&2; exit 1 ;;
esac
[ -d node_modules/maplibre-gl/dist ] || { echo "Run npm install first." >&2; exit 1; }

rm -rf "${OUT:?}"
mkdir -p "$OUT/app/vendor" "$OUT/demos"

cp -R site/. "$OUT/"                       # landing page, poster, recorded answers
mv "$OUT/replays" "$OUT/app/replays"       # the client looks for replays/ next to itself
cp -R public/. "$OUT/app/"                 # the real client, unchanged
for file in maplibre-gl.mjs maplibre-gl-shared.mjs maplibre-gl-worker.mjs maplibre-gl.css; do
  cp "node_modules/maplibre-gl/dist/$file" "$OUT/app/vendor/"
done
cp demos/*.mp4 "$OUT/demos/"
touch "$OUT/.nojekyll"                     # plain files, no Jekyll

echo "Built $OUT ($(du -sh "$OUT" | cut -f1))"
