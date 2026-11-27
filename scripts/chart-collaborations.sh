#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
jq -r '[.recordings[]|select((.artist_mbids|length)>1)|.recording_mbid|select(type=="string")]|unique[]' corpus/priority.json > "$tmp/ids"
split -l 20 "$tmp/ids" "$tmp/batch-"
for batch in "$tmp"/batch-*; do
 q=$(awk '{if(NR>1)printf " OR ";printf "rid:%s",$0}' "$batch")
 curl -fsSG --retry 2 --max-time 15 -A 'SevenDegrees/0.1 (https://github.com/cheeseonamonkey/SevenDegrees)' https://musicbrainz.org/ws/2/recording --data-urlencode "query=$q" -d fmt=json -d limit=100 |
   ./degrees normalize >> "$tmp/facts"
 sleep 1.1
done
jq -cs 'unique_by(.id)[]' "$tmp/facts" > "$tmp/chart.jsonl"
mv "$tmp/chart.jsonl" corpus/musicbrainz-chart-collaborations.jsonl
