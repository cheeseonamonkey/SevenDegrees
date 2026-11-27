# Corpus

- curated.jsonl: four manually verified facts, with source URLs & MusicBrainz artist IDs.
- musicbrainz-morello.jsonl: 86 multi-artist recording credits from the first 100 search hits for Tom Morello.
- musicbrainz-tankian.jsonl: 16 multi-artist recording credits from the first 100 search hits for Serj Tankian.
- musicbrainz-bowie.jsonl: 3 multi-artist recording credits from the first 100 search hits for David Bowie.

Snapshot acquired 2026-11-27. Query: `https://musicbrainz.org/ws/2/recording?query=arid:<MBID>&limit=100&fmt=json`. Normalized with `degrees normalize`; recording MBIDs are retained, so overlapping shards upsert rather than duplicate facts. Counts refer to retained rows, not comprehensive discographies.

MusicBrainz core data is CC0: https://musicbrainz.org/doc/MusicBrainz_Database/License. Curated records contain factual metadata and citations, not copied descriptions or audio. No Spotify data is stored.

Auckland Philharmonia and Gang of Four API searches returned HTTP 503 during this snapshot; their manually verified facts are retained. No missing relationship is interpreted as proof of absence.
