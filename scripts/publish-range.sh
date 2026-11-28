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
assert m["layout"]=="range-v1" and m["edge_encoding"]=="category-v1"
assert m["people_stats"]["musical_statements"]>700000 and m["atlas"]
PY
# Verify the full record and incidence round-trip before publishing.
bulk="bulk/${release#corpus-mb-}"
uv run --no-project --with orjson==3.11.4 scripts/static-index.py .cache/full/graph.json.gz "$src" --seed "$bulk/seed" --bulk "$bulk/shards" --stats "$bulk/stats.txt" --verify
# Already compressed independent blocks; tar adds negligible overhead.
tar -C "$src" -cf "$root/web-atlas-index.tar" .
[[ $(stat -c %s "$root/web-atlas-index.tar") -lt $((950*1024*1024)) ]]
(cd "$root"; sha256sum web-atlas-index.tar > web-atlas-index.sha256)
python3 scripts/install-index.py "$root/web-atlas-index.tar" "$root/test-site/api/v1"
node scripts/pages-test.js "$root/test-site"
cp web/{index.html,style.css,app.js,graph.js,graph-client.js,graph-worker.js,cytoscape.min.js,force-graph-3d.min.js,force-graph-3d.min.js.LEGAL.txt,viewer.js,relationships.js,layout-worker.min.js,layout-worker.LICENSE} "$root/test-site/"
sed -i 's/<head>/<head><meta name="static-graph" content="true">/' "$root/test-site/index.html"
node scripts/browser-test.js "$root/test-site"
gh release upload "$release" "$root/web-atlas-index.tar" --clobber
gh release upload "$release" "$root/web-atlas-index.sha256" --clobber
gh workflow run pages.yml --ref main
