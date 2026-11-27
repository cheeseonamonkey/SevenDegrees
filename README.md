# SevenDegrees

A musical relationship corpus & degrees-of-separation engine. The corpus is the project; the game is a consumer.

Recording credits, live performances, covers, tributes, group membership and production credits are represented as evidence-bearing facts, not speculative artist-to-artist links.

## Run

Requires Go 1.24+, CGO and a C compiler (SQLite).

```sh
go build -o degrees .
./degrees import corpus/*.jsonl
./degrees find "Tom Morello" "David Bowie"
./degrees -strict find "Tom Morello" "David Bowie"
./degrees neighbors "Serj Tankian"
./degrees stats
go test ./...
```

Flags precede commands. Exact, case-insensitive observed names or MusicBrainz IDs are accepted; ambiguous names are rejected.

## Corpus

JSONL is canonical; the SQLite database is a disposable projection. Each row describes a recording, performance, cover, tribute or membership with stable IDs, participant roles and a source URL. Reimporting a fact replaces that fact's participants in one transaction. No genre, playlist, label or compilation shortcuts.

```sh
./degrees fetch 42a636a0-dbe4-4d0c-abe2-1590fad9531b > /tmp/morello.jsonl
# Only replace a committed snapshot after a successful fetch.
./degrees import /tmp/morello.jsonl
```

MusicBrainz core metadata: CC0 (https://musicbrainz.org/doc/MusicBrainz_Database/License). Curated factual assertions have individual citations; source text/audio is not redistributed. Structured artist-credit join phrases identify featured artists; recording credits are not proof of in-person interaction. Cover and tribute facts link performer to original artist, never two unrelated cover performers.

## Knowledge graph / OWL

The existing game index is one projection of a broader music knowledge graph.
See [ontology](ontology/music.ttl) and [RDF snapshots](snapshots/README.md).

```sh
cat corpus/*.jsonl | ./degrees rdf > snapshots/seed.nt
scripts/snapshot.sh instrument 20261125-001001
# Any supported MusicBrainz JSON entity dump can use the same pipeline.
```

Full corpus ingestion should reuse the public LinkedMusic graph where practical,
with locally versioned CC0 snapshots for reproducibility. OWL defines the schema;
N-Triples shards are data, and SQLite remains the small traversal projection.

## Plan

- [x] Versioned evidence-bearing seed corpus
- [x] SQLite projection, role-aware traversal, bounded shortest paths
- [x] MusicBrainz recording-credit fetcher with request pacing
- [ ] Bulk MusicBrainz dump adapter, including artist relationships and work-level credits
- [ ] Explicit work/recording mapping for covers; avoid inferring an original performer from a songwriter alone
- [x] OWL vocabulary, RDF export, streaming JSON dump projection, first instrument snapshot
- [ ] Bulk RDF shard publication, source-specific license manifests and graph-to-game projection
- [ ] Provider alias ingestion, richer disambiguation and weighted alternatives
- [ ] Daily puzzle / web interface / RPC

No full MusicBrainz mirror yet. The current traversal is single-source BFS; it reports shortest paths within the imported corpus only.
