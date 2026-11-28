#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output=${1:-.cache/pages}
release=${PAGES_RELEASE:-}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
api="$output/api/v1"
if [[ -n "$release" ]]; then
 python3 scripts/pages-release.py "$release" "$tmp"
 python3 scripts/install-index.py "$tmp/web-atlas-index.tar" "$api"
else
 go build -o "$tmp/degrees" .
 db="$tmp/seed.sqlite"
 "$tmp/degrees" -db "$db" import corpus/*.jsonl
 "$tmp/degrees" -db "$db" stats > "$tmp/stats.txt"
 "$tmp/degrees" -db "$db" export-static | gzip -n -6 > "$tmp/graph.json.gz"
 uv run --no-project --with orjson==3.11.4 scripts/static-index.py "$tmp/graph.json.gz" "$tmp/index" --stats "$tmp/stats.txt"
 uv run --no-project --with orjson==3.11.4 scripts/static-index.py "$tmp/graph.json.gz" "$tmp/index" --stats "$tmp/stats.txt" --verify
 python3 scripts/install-index.py "$tmp/index" "$api"
fi
mkdir -p "$api/ontology"
cp web/{index.html,style.css,app.js,graph.js,graph-client.js,graph-worker.js,cytoscape.min.js,cytoscape.LICENSE,force-graph-3d.min.js,force-graph-3d.min.js.LEGAL.txt,force-graph-3d.LICENSE,viewer.js,relationships.js,layout-worker.min.js,layout-worker.LICENSE} "$output/"
sed -i 's/<head>/<head><meta name="static-graph" content="true">/' "$output/index.html"
cp ontology/{relations,categories}.json "$api/"
cp ontology/*.ttl "$api/ontology/"
touch "$output/.nojekyll"
