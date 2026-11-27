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

## Relationship expansion (2026-11-27)

| Shard | Facts | Source |
|---|---:|---|
| musicbrainz-chart-collaborations.jsonl | 81 | MusicBrainz recording IDs selected from ListenBrainz multi-artist chart entries |
| wikidata-membership.jsonl | 269 | P527 group membership for the top 100 ranked artists |
| wikidata-covers.jsonl | 36 | Q155171 cover versions with explicit P5059/P144 links to a source version and P175 performers |
| wikidata-recordings.jsonl | 190 | P175/P162 performer and producer credits on audio tracks/recordings identified with P4404 |

Wikidata structured data is CC0 (https://www.wikidata.org/wiki/Wikidata:Licensing).
Wikidata entities are mapped to MusicBrainz via P434; ambiguous multi-ID
crosswalks are excluded rather than creating duplicate artist identities.
These are source assertions, not independently verified historical claims.
Membership does not assert that two members played together at the same time.
No full discography is stored. Query limits and missing IDs constrain coverage.

Current graph: 773 artists, 685 facts, 1,538 participation records.
