#!/usr/bin/env bash
# Snapshot aggregate popularity, not user-level listening histories.
set -euo pipefail
cd "$(dirname "$0")/.."
count=${1:-1000}
per_artist=${2:-10}
tracks=${3:-20}
[[ "$count" =~ ^[1-9][0-9]*$ && "$per_artist" =~ ^[0-9]+$ && "$tracks" =~ ^[1-9][0-9]*$ ]]
((count<=1000 && per_artist<=count))
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
api=https://api.listenbrainz.org/1
for kind in artists recordings; do
  curl -fsSL --retry 2 --max-time 30 "$api/stats/sitewide/$kind?range=all_time&count=$count" > "$tmp/$kind.json"
  jq -e --arg k "$kind" '.payload[$k] | length > 0' "$tmp/$kind.json" >/dev/null
done
: > "$tmp/artist-tracks.jsonl"
while IFS= read -r id; do
  if curl -fsSL --retry 1 --max-time 10 "$api/popularity/top-recordings-for-artist/$id" > "$tmp/top.json"; then
    jq -c --arg id "$id" --argjson tracks "$tracks" '{artist_mbid:$id, recordings:(.[:$tracks]|map({recording_mbid,recording_name,total_listen_count,total_user_count}))}' "$tmp/top.json" >> "$tmp/artist-tracks.jsonl"
  else
    jq -cn --arg id "$id" '{artist_mbid:$id, recordings:[], error:"source request failed"}' >> "$tmp/artist-tracks.jsonl"
  fi
  sleep 0.25
done < <(jq -r --argjson n "$per_artist" '.payload.artists[:$n][] | .artist_mbid // empty' "$tmp/artists.json")
jq -n --slurpfile a "$tmp/artists.json" --slurpfile r "$tmp/recordings.json" --slurpfile p "$tmp/artist-tracks.jsonl" --arg retrieved "$(date -u +%FT%TZ)" '
  {source:"https://api.listenbrainz.org/1", retrieved:$retrieved, range:"all_time",
   artist_stats_updated:$a[0].payload.last_updated, recording_stats_updated:$r[0].payload.last_updated,
   artists:($a[0].payload.artists|map({artist_mbid,artist_name,listen_count})),
   recordings:($r[0].payload.recordings|map({recording_mbid,track_name,artist_mbids,artist_name,listen_count})),
   artist_recordings:$p}' > "$tmp/priority.json"
mv "$tmp/priority.json" corpus/priority.json
