# Corpus

- curated.jsonl: four manually verified facts, with source URLs & MusicBrainz artist IDs.
- musicbrainz-morello.jsonl: 86 multi-artist recording credits from the first 100 search hits for Tom Morello.
- musicbrainz-tankian.jsonl: 16 multi-artist recording credits from the first 100 search hits for Serj Tankian.
- musicbrainz-bowie.jsonl: 3 multi-artist recording credits from the first 100 search hits for David Bowie.

Snapshot acquired 2026-11-27. Query: `https://musicbrainz.org/ws/2/recording?query=arid:<MBID>&limit=100&fmt=json`. Normalized with `degrees normalize`; recording MBIDs are retained, so overlapping shards upsert rather than duplicate facts. Counts refer to retained rows, not comprehensive discographies.

MusicBrainz core data is CC0: https://musicbrainz.org/doc/MusicBrainz_Database/License. Curated records contain factual metadata and citations, not copied descriptions or audio. No Spotify data is stored.

Auckland Philharmonia and Gang of Four API searches returned HTTP 503 during this snapshot; their manually verified facts are retained. No missing relationship is interpreted as proof of absence.

## Popularity-first ingestion

`priority.json` is an aggregate ListenBrainz all-time popularity snapshot (https://listenbrainz.org/data/, CC0 listen data). It includes 1,000 ranked artists and 1,000 globally ranked recordings, plus top 20 recordings for each of the ten highest-ranked artists where available. Eight artist-specific charts succeeded; two returned HTTP 401 and are explicitly marked missing. There are 1,035 distinct non-null recording MBIDs across the charts.

Refresh with `scripts/priority.sh 1000 10 20`. Ingestion uses stable IDs rather than ambiguous names. ListenBrainz users are not representative of worldwide listening, so this is an ingestion priority, not an objective fame ranking or an exclusion rule. No user histories are collected.
