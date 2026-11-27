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

## Web

```sh
./degrees import corpus/*.jsonl
./degrees serve
# http://127.0.0.1:8077
```

The embedded web UI uses the same SQLite graph and shortest-path engine as the CLI.
Artist autocomplete, strict mode and source links are available. The default bind
is loopback; external hosting is a separate deployment decision.

## Relationship-first corpus

We need evidence of connections, not exhaustive discographies. Ingest multi-artist
recordings, explicit covers and tributes, group memberships, and producer credits.
Solo recordings are retained only when they establish a relationship; popularity
sets the acquisition order, not an exclusion criterion for connecting artists.

```sh
scripts/chart-collaborations.sh
scripts/wikidata.sh
```

See [source notes](corpus/README.md). Rebuild the disposable SQLite projection from
a fresh database after replacing shards, so removed facts do not remain indexed.

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
- [x] Bulk MusicBrainz dump adapter, including artist relationships and work-level credits
- [x] Explicit work/recording references for covers, distinguished from confirmed originals
- [x] OWL vocabulary, RDF export, streaming JSON dump projection, first instrument snapshot
- [ ] Bulk RDF shard publication, source-specific license manifests and graph-to-game projection
- [ ] Provider alias ingestion, richer disambiguation and weighted alternatives
- [x] Web path explorer and HTTP API
- [x] Public Pages deployment, graph explorer and read-only MCP adapter
- [ ] Daily puzzle and incremental full-graph loading

No full MusicBrainz mirror yet. The current traversal is bidirectional BFS; it reports shortest paths within the imported corpus only.

## Bulk relationship corpus

The full MusicBrainz CC0 PostgreSQL export is staged one table at a time.
Only relationship evidence is emitted; releases and solo recordings are not
published as discographies. The pipeline merges multi-artist recording credits,
performer/producer credits, memberships, explicit album covers, and marked
song covers with a uniquely credited unflagged reference version. The latter
are explicitly `cover-reference`, not claims of original authorship; strict
mode excludes them. Repeated title/role/artist sets are collapsed, and
placeholder artists and oversized recording credits are excluded.

```sh
scripts/bulk.sh 20261125-002239 --publish
# Outputs: bulk/<version>/shards/, manifest.json, graph.sqlite, stats.txt
# --publish uploads compressed facts and checksums to a GitHub release.
# Resume by rerunning the same command; downloads and completed staging
# tables are reused. The original seed is frozen at the beginning.
```

Gzip JSONL is directly supported by `degrees import`. Bulk outputs and cache
are excluded from Git history. The source archive is checksum-verified.
The full graph is built fresh, then checked before publication. The current
seed remains available throughout the build.

## GitHub Pages and static data API

[Explore SevenDegrees](https://cheeseonamonkey.github.io/SevenDegrees/).

The full corpus contains **1,595,768 artists, 7,744,208 facts and 22,789,513
participant relationships**. Pages defaults to a smaller popularity-first
projection (93,472 artists, 373,708 facts). The full projection is an optional
large download once its verified export is published. Neither projection
discards source facts from the canonical [release](https://github.com/cheeseonamonkey/SevenDegrees/releases/tag/corpus-mb-20261125-002239).

Static API: `api/v1/manifest.json`, `api/v1/stats.json`, `api/v1/relations.json`,
`api/v1/ontology/`, and the gzip graph URL/parts advertised by the manifest.
The format is integer-indexed CSR adjacency with shared evidence and string
dictionaries. Each pair retains one witness per strict-mode eligibility class,
not every recording. The full corpus retains the other evidence.
A vanilla JS worker uses the shared graph client for path and neighbor queries;
Cytoscape.js renders the bounded interactive neighborhood. The API serves static
files, not server-side dynamic SPARQL or arbitrary RPC.

### Read-only MCP

```sh
npm ci
npm run mcp
```

Configure a local MCP client with command `node` and argument
`/absolute/path/to/SevenDegrees/mcp.mjs`. The official SDK provides stdio
transport. Tools: `music_stats`, `music_search`, `music_path`,
`music_neighbors`. Set `scope: "full"` when the full graph is published.
The server uses the same static graph client as the website; it requires no
credentials or writes. Pages itself cannot host a dynamic MCP transport.

### Semantic tools (.NET 10)

```sh
dotnet run --project semantic -- query snapshots/seed.nt queries/relationship-counts.rq
dotnet run --project semantic -- validate snapshots/seed.nt ontology/shapes.ttl
dotnet run --project semantic -- stats bulk/20261125-002239/graph.sqlite
```

dotNetRDF executes SPARQL and SHACL locally; Microsoft.Data.Sqlite opens the
existing index read-only. This is the initial C# migration slice, not a second
ingestion/traversal engine. The full RDF corpus is not loaded into memory by
default. Relation rules in `ontology/relations.json` drive validation in Go
and the Python bulk importer, and generate OWL types and SHACL constraints via
`python3 scripts/schema.py`. Existing RDF predicates remain compatible.

### Build and publish

```sh
PAGES_RELEASE=corpus-mb-20261125-002239 scripts/pages.sh .cache/pages
./degrees -db bulk/20261125-002239/graph.sqlite export-static | gzip -n -6 > .cache/full/graph.json.gz
scripts/publish-full.sh .cache/full/graph.json.gz
```

Actions verifies release checksums before building. Full export publication
verifies counts and splits the compressed stream into bounded assets, then
triggers Pages deployment. The full snapshot may require desktop-class memory;
the priority snapshot remains the mobile default.
