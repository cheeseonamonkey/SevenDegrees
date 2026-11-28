#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
file=.cache/owl/MusicAtlas.ttl.gz
tag=owl-mb-20261125-002239
grep -q "professional_assertions.*815274" .cache/owl/complete.log
gzip -t "$file"
hash=$(sha256sum "$file" | cut -d' ' -f1)
printf 'Self-contained OWL/RDF Turtle, gzip compressed. MusicBrainz and Wikidata CC0 source assertions.\n\n7,744,208 original facts; 2,359,441 typed artist profiles; 815,274 professional relationship assertions (665,920 memberships).\n\nSHA256: %s\n' "$hash" > .cache/owl/release-notes
if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --draft --title "MusicAtlas — portable OWL knowledge graph" --notes-file .cache/owl/release-notes --target main
fi
gh release upload "$tag" "$file" --clobber
gh release edit "$tag" --draft=false
gh release view "$tag" --json url,assets,isDraft --jq '{url,isDraft,assets:[.assets[]|{name,size}]}'
