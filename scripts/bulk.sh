#!/usr/bin/env bash
# Resumable, relationship-only snapshot build. Outputs stay outside Git history.
set -euo pipefail
cd "$(dirname "$0")/.."
base=https://data.metabrainz.org/pub/musicbrainz/data/fullexport
version=${1:-$(curl -fsSL "$base/LATEST")}
[[ "$version" =~ ^[0-9]{8}-[0-9]{6}$ ]]
publish=${2:-}
[[ -z "$publish" || "$publish" == "--publish" ]]
root="$PWD/bulk/$version"
mkdir -p "$root"
exec 9>"$root/build.lock"
flock -n 9 || { echo "Build already running for $version"; exit 1; }
echo "Started $(date -Is) | MusicBrainz $version"
df -h "$root"
# Freeze the source snapshot and seed manifest for reproducibility.
git rev-parse HEAD > "$root/code-commit"
mkdir -p "$root/seed"
if [[ ! -f "$root/seed/.ready" ]]; then
    cp corpus/*.jsonl corpus/priority.json "$root/seed/"
    touch "$root/seed/.ready"
fi
archive="$root/mbdump.tar.bz2"
curl -fsSL --retry 8 --connect-timeout 20 "$base/$version/SHA256SUMS" -o "$root/SHA256SUMS"
grep -E '[ *]mbdump\.tar\.bz2$' "$root/SHA256SUMS" > "$root/archive.sha256"
if [[ ! -f "$archive" ]]; then
    curl -fL --retry 20 --retry-delay 15 --connect-timeout 30 --speed-limit 1024 --speed-time 120 \
        -C - "$base/$version/mbdump.tar.bz2" -o "$archive.part"
    mv "$archive.part" "$archive"
fi
(cd "$root"; sha256sum -c archive.sha256)
if [[ ! -f "$root/shards/manifest.json" ]]; then
    tmp=$(mktemp -d "$root/.shards-XXXXXX")
    trap 'rm -rf -- "$tmp"' EXIT
    python3 -u scripts/bulk_relationships.py "$archive" "$root/stage.sqlite" "$tmp" \
        --priority "$root/seed/priority.json" --seed "$root/seed"
    python3 - "$tmp" "$version" "$root" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1])/"manifest.json"
root=pathlib.Path(sys.argv[3])
m=json.loads(p.read_text())
m.update(source="https://data.metabrainz.org/pub/musicbrainz/data/fullexport/"+sys.argv[2]+"/mbdump.tar.bz2",
         license="CC0", source_sha256=(root/"archive.sha256").read_text().split()[0],
         code_commit=(root/"code-commit").read_text().strip(),
         seed_files={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((root/"seed").glob("*.json*"))})
p.write_text(json.dumps(m,indent=2)+"\n")
PY
    mv "$tmp" "$root/shards"
    trap - EXIT
fi
if [[ ! -f "$root/graph.sqlite" ]]; then
    go build -o "$root/degrees" .
    # Rebuild rather than upsert into the old graph: removed source rows disappear.
    index="$root/graph.sqlite.build"
    rm -f "$index" "$index-wal" "$index-shm"
    "$root/degrees" -db "$index" import "$root"/seed/*.jsonl
    shopt -s nullglob
    priority=("$root"/shards/priority-*.jsonl.gz)
    longtail=("$root"/shards/longtail-*.jsonl.gz)
    if ((${#priority[@]})); then "$root/degrees" -db "$index" import "${priority[@]}"; fi
    echo 'Priority graph:'
    "$root/degrees" -db "$index" stats
    if ((${#longtail[@]})); then "$root/degrees" -db "$index" import "${longtail[@]}"; fi
    [[ "$(sqlite3 "$index" 'PRAGMA quick_check;')" == "ok" ]]
    mv "$index" "$root/graph.sqlite"
fi
go build -o "$root/degrees" .
"$root/degrees" -db "$root/graph.sqlite" stats | tee "$root/stats.txt"
if [[ "$publish" == "--publish" ]]; then
    tag="corpus-mb-$version"
    if ! gh release view "$tag" >/dev/null 2>&1; then
        gh release create "$tag" --draft --target "$(cat "$root/code-commit")" \
            --title "MusicBrainz relationship corpus $version" \
            --notes "CC0 relationship-only snapshot. Merge these shards after the repository seed JSONL. Includes collaboration, production, membership and cover evidence. See manifest.json for counts and hashes."
    fi
    if [[ "$(gh release view "$tag" --json isDraft --jq .isDraft)" == "true" ]]; then
        gh release upload "$tag" "$root"/shards/*.jsonl.gz "$root/shards/manifest.json" "$root/stats.txt" --clobber
        gh release edit "$tag" --draft=false
    fi
fi
echo "Completed $(date -Is)"
