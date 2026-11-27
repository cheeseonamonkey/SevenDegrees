#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
src=${1:?usage: publish-full.sh GRAPH.json.gz [RELEASE]}
release=${2:-corpus-mb-20261125-002239}
root=.cache/full/parts
mkdir -p "$root"
uv run --no-project --with ijson scripts/full-parts.py "$src" "$root"
python3 - "$root/web-full-manifest.json" "bulk/${release#corpus-mb-}/stats.txt" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
s={k:int(v) for k,v in (line.split(": ") for line in open(sys.argv[2]))}
assert m["stats"]["artist"]==s["artist"] and m["stats"]["fact"]==s["fact"], (m,s)
assert m["bytes"]<850*1024*1024, "full projection exceeds Pages deployment budget"
PY
# The manifest is the publication marker: upload only after all parts succeed.
gh release upload "$release" "$root"/web-full-*.gzpart --clobber
gh release upload "$release" "$root/web-full-manifest.json" --clobber
gh workflow run pages.yml --ref main
