#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output=${1:-.cache/pages}
db=${2:-}
mkdir -p "$output"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
go build -o "$tmp/degrees" .
if [[ -z "$db" ]]; then
 db="$tmp/seed.sqlite"
 "$tmp/degrees" -db "$db" import corpus/*.jsonl
fi
"$tmp/degrees" -db "$db" export-static > "$tmp/graph.json"
cp web/{index.html,style.css,app.js,graph.js} "$output/"
sed -i 's/<head>/<head><meta name="static-graph" content="true">/' "$output/index.html"
mv "$tmp/graph.json" "$output/graph.json"
touch "$output/.nojekyll"
