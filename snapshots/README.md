# RDF snapshots

The checked-in seed and instrument snapshot are derived data, not a second authoritative corpus.

| File | Source |
|---|---|
| seed.nt | Existing versioned JSONL facts (`cat corpus/*.jsonl \| ./degrees rdf`) |
| musicbrainz-instrument-20261125-001001.nt.zst | Official MusicBrainz CC0 instrument JSON dump (source URL and SHA256 sidecars) |

The instrument source archive passed upstream SHA256 verification. RDFLib parsed the ontology and both datasets: 50,948 distinct triples including 1,063 typed instruments. Generated N-Triples may contain repeated statements; RDF graph loading deduplicates them.

Use `scripts/snapshot.sh ENTITY [VERSION]` after building the binary. Downloads remain in ignored .cache/; RDF shards are compressed. GitHub blocks ordinary Git files over 100 MiB; large shards should be split or published as release assets with checksums, not committed monolithically.

## Upstream sources

- MusicBrainz JSON dump: https://data.metabrainz.org/pub/musicbrainz/data/json-dumps/ (CC0; source archive verified before conversion).
- MusicBrainz PostgreSQL core: https://data.metabrainz.org/pub/musicbrainz/data/fullexport/ (CC0; about 7 GB compressed on 2026-11-25).
- Wikidata: https://www.wikidata.org/wiki/Wikidata:Database_download (CC0; use music subset and preserve source IDs).
- LinkedMusic: https://github.com/DDMAL/linkedmusic-datalake/wiki/Project-Status (386,272,871 reported triples, 2026-06-21; public SPARQL endpoint https://virtuoso.simssa.ca/sparql/ verified with a five-row query on 2026-11-27). Reuse as an external query source; not mirrored here. Review per-source licenses before copying.
- Discogs / SecondHandSongs: redistribution rights need source-specific review.
- Spotify: no bulk metadata copying.

## Scope

The OWL vocabulary describes entities, evidence facts, participations and qualified source relationships. The dump converter currently projects names, descriptions, aliases, artist credits and relationship targets/attributes/direction/dates. It is not a lossless JSON conversion: unmapped fields such as track lists, release metadata and detailed attribute values remain in upstream archives. The existing degrees SQLite index still consumes the JSONL facts, not arbitrary RDF. No bulk Wikidata or LinkedMusic ingestion yet.
