#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output=${1:-.cache/pages}
db=${2:-}
release=${PAGES_RELEASE:-}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
go build -o "$tmp/degrees" .
if [[ -z "$db" ]]; then
 db="$tmp/seed.sqlite"
 files=(corpus/*.jsonl)
 if [[ -n "$release" ]]; then
  [[ "$release" =~ ^corpus-mb-[0-9]{8}-[0-9]{6}$ ]]
  # Use only the priority assets, pin their release, verify size and checksum.
  python3 scripts/pages-release.py "$release" "$tmp"
  files+=("$tmp"/priority-*.jsonl.gz)
 fi
 "$tmp/degrees" -db "$db" import "${files[@]}"
fi
api="$output/api/v1"
mkdir -p "$api"
"$tmp/degrees" -db "$db" export-static | gzip -n -6 > "$tmp/graph.json.gz"
python3 - "$tmp/graph.json.gz" "$api" "$release" "$tmp" <<'PY'
import gzip, hashlib, json, pathlib, shutil, sys
src,api=map(pathlib.Path,sys.argv[1:3])
with gzip.open(src,"rt") as f: g=json.load(f)
release=sys.argv[3]
stats={"artist":len(g["artists"]),"fact":g["facts"],"directed_edges":len(g["adjacency"])//2}
manifest={"api_version":1,"graph_version":g["version"],"scope":"priority" if release else "local-snapshot",
          "graph":{"url":"graph.json.gz","encoding":"gzip","bytes":src.stat().st_size,"sha256":hashlib.file_digest(src.open("rb"),"sha256").hexdigest()},
          "stats":stats,"relations":"relations.json","ontology":"ontology/music.ttl",
          "full_corpus":"https://github.com/cheeseonamonkey/MusicAtlas/releases/tag/corpus-mb-20261125-002239"}
if release:manifest["release"]=release
temp=pathlib.Path(sys.argv[4])
if (temp/"stats.txt").exists():
    manifest["corpus_stats"]={k:int(v) for k,v in (line.split(": ") for line in (temp/"stats.txt").read_text().splitlines())}
if (temp/"web-full-manifest.json").exists():
    full=json.loads((temp/"web-full-manifest.json").read_text())
    folder=api/"full"
    folder.mkdir(exist_ok=True)
    for part in full["parts"]:
        name=part.pop("name")
        shutil.move(temp/name,folder/name)
        part["url"]="full/"+name
    manifest["full"]=full
(api/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
(api/"stats.json").write_text(json.dumps(stats)+"\n")
PY
cp web/{index.html,style.css,app.js,graph.js,graph-client.js,graph-worker.js,cytoscape.min.js,cytoscape.LICENSE} "$output/"
sed -i 's/<head>/<head><meta name="static-graph" content="true">/' "$output/index.html"
mv "$tmp/graph.json.gz" "$api/graph.json.gz"
cp ontology/relations.json "$api/"
mkdir -p "$api/ontology"
cp ontology/*.ttl "$api/ontology/"
rm -f "$output/graph.json" "$output/graph.json.gz"
touch "$output/.nojekyll"
