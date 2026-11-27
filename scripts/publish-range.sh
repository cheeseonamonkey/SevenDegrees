#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
src=${1:?usage: publish-range.sh INDEX [RELEASE]}
release=${2:-corpus-mb-20261125-002239}
root=.cache/range/release
mkdir -p "$root"
python3 - "$src/manifest.json" "bulk/${release#corpus-mb-}/stats.txt" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
s={k:int(v) for k,v in (line.split(": ") for line in open(sys.argv[2]))}
assert all(m["stats"][k]==v for k,v in s.items()), (m["stats"],s)
assert m["layout"]=="range-v1"
PY
# Verify the full record and incidence round-trip before publishing.
bulk="bulk/${release#corpus-mb-}"
uv run --no-project --with orjson==3.11.4 scripts/static-index.py .cache/full/graph.json.gz "$src" --seed "$bulk/seed" --bulk "$bulk/shards" --stats "$bulk/stats.txt" --verify
# Already compressed independent blocks; tar adds negligible overhead.
tar -C "$src" -cf "$root/web-range-index.tar" .
[[ $(stat -c %s "$root/web-range-index.tar") -lt $((950*1024*1024)) ]]
(cd "$root"; sha256sum web-range-index.tar > web-range-index.sha256)
python3 scripts/install-index.py "$root/web-range-index.tar" "$root/test-site/api/v1"
node scripts/pages-test.js "$root/test-site"
gh release upload "$release" "$root/web-range-index.tar" --clobber
gh release upload "$release" "$root/web-range-index.sha256" --clobber
gh workflow run pages.yml --ref main
