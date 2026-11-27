#!/usr/bin/env bash
# Download one official JSON dump, verify its digest, and stream RDF to a compressed shard.
set -euo pipefail
cd "$(dirname "$0")/.."
kind=${1:?usage: scripts/snapshot.sh ENTITY [YYYYMMDD-HHMMSS]}
case "$kind" in area|artist|event|instrument|label|place|recording|release|release-group|series|work) ;; *) echo "invalid entity type" >&2; exit 2;; esac
base=https://data.metabrainz.org/pub/musicbrainz/data/json-dumps
version=${2:-$(curl -fsSL "$base/LATEST")}
[[ "$version" =~ ^[0-9]{8}-[0-9]{6}$ ]]
mkdir -p .cache/musicbrainz/"$version" snapshots
cache=.cache/musicbrainz/"$version"
archive="$kind.tar.xz"
url="$base/$version/$archive"
curl -fsSL --retry 2 "$base/$version/SHA256SUMS" -o "$cache/SHA256SUMS"
grep -E "[ *]$archive$" "$cache/SHA256SUMS" > "$cache/$kind.sha256"
if [[ ! -f "$cache/$archive" ]]; then
  curl -fSL --retry 2 -C - "$url" -o "$cache/$archive.part"
  mv "$cache/$archive.part" "$cache/$archive"
fi
(cd "$cache"; sha256sum -c "$kind.sha256")
shard="snapshots/musicbrainz-$kind-$version.nt.zst"
tmp=$(mktemp "$shard.XXXXXX")
trap 'rm -f "$tmp"' EXIT
tar -xOJf "$cache/$archive" "mbdump/$kind" | ./degrees rdf-dump "$kind" | zstd -q -T2 -f -o "$tmp"
mv "$tmp" "$shard"
sha256sum "$shard" > "$shard.sha256"
printf '%s\n' "$url" > "$shard.source"
