# MusicAtlas

An open music relationship atlas for exploring artists, collaborators, covers, credits and the networks between them. Inspired by degrees of separation; designed for discovery rather than scoring.

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

The artist relationship index is one projection of a broader music knowledge graph.
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
- [ ] Bulk RDF shard publication, source-specific license manifests and graph-to-explorer projection
- [ ] Provider alias ingestion, richer disambiguation and weighted alternatives
- [x] Web path explorer and HTTP API
- [x] Public Pages deployment, graph explorer and read-only MCP adapter
- [ ] Incremental full-graph loading and richer relationship exploration

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

[Explore MusicAtlas](https://cheeseonamonkey.github.io/MusicAtlas/).

The full corpus contains **1,595,768 artists, 7,744,208 facts and 22,789,513
participant relationships**. The website uses the entire corpus without
downloading the entire graph. No smaller default dataset or download switch.

The [static manifest](https://cheeseonamonkey.github.io/MusicAtlas/api/v1/manifest.json)
describes immutable data files and compressed indexes. Every data block is an
independent gzip member. A section's index stores its pack number, byte offset,
and compressed length; clients request only that byte range (HTTP 206).
Packs are capped at 16 MiB unless a single indivisible block is larger.

| Section | Contents |
| --- | --- |
| artist | Stable IDs, names and aliases |
| search | Name and word-prefix index (ranked by exact match and popularity) |
| topology | Integer adjacency and policy bits for pathfinding |
| witness | A source-backed witness per projected relationship |
| fact | Every canonical source fact, including all original participant names and roles |
| incidence | Complete artist-to-fact reverse index |

The topology is a traversal projection, **not the evidence corpus**. All facts
remain available through paginated artist and shared-record queries. The build
round-trips every fact against the canonical release and verifies incidence.
The client coalesces close ranges, deduplicates in-flight requests, uses eight
concurrent reads and an 8 MiB compressed-weight LRU cache. Bidirectional BFS
reads topology first and retrieves artist names/evidence only for its result.
The vanilla JS worker keeps the interface responsive. The graph explorer uses Cytoscape.js by default, with on-demand 3D Force Graph (Three.js). All connected artists remain searchable. Local maps retain expansion state,
grow incrementally without a fixed cumulative cap, and export to JSON. Five independent
category checkboxes constrain traversal and timeline exploration. Both renderers use category-colored edges and scalable outlined labels. The layout panel offers spacing, relationship-type clustering, force-directed layout, label visibility and an induced-map connection operation. Path output gives the degree count and evidence-aware natural-language descriptions. Listening links search Spotify, rather than guessing track IDs; evidence retains original provenance.

This is a read-only static file API, not a server accepting arbitrary SPARQL
or dynamic RPC requests. The shared graph client provides logical search,
neighbor, path and evidence operations over those files. Search matches name
and word prefixes, not arbitrary infixes. Large or unsuccessful path searches
can still read many topology blocks; paths are bounded to 12 links.

### Relationship parameters

Every path and neighborhood query accepts five independent optional booleans:
`collaborations`, `memberships`, `production`, `covers`, `professional`.
Unspecified flags default to enabled (or retain the existing mask/strict
setting). For example, in the shared JS client:

```js
await query('/api/path', {from: 'The Wiggles', to: 'Slayer', covers: false, production: true});
```

The local HTTP server accepts the equivalent query parameters, e.g.
`/api/path?from=The+Wiggles&to=Slayer&covers=false&production=true`.
MCP tools expose the same boolean parameters. GitHub Pages hosts static data,
so dynamic queries execute in the shared client, not as server-side routes.

### Ranked web generation

The map settings expose a draw fraction (default 0.4), decay per hop (0.65),
depth (3), max per artist (16), and per-operation link budget (100).
Explore reserves capacity for later layers and allocates each layer round-robin,
preferring new artists. Grow map chooses up to 32 least-explored branches and
adds fresh artists; Expand adds more connections for one selected artist.
Neither operation has a lifetime display cap. Per-request limits (1,000 links,
250 per artist, 8 layers) bound work rather than total map size.
At hop `d`, the eligible-neighbor fraction and branch cap are multiplied by
`decay ** d`. The ranking favors popularity, with a small hub penalty and a
bounded bonus for artists with onward connections. Seeded variation is
deterministic. Optional cross-links scan newly added artists against the map.
Large 2D maps use an off-thread Barnes–Hut force layout with soft anchors for
existing positions. Device memory and rendering performance remain practical
limits. Rebuild the checked-in layout worker with `npm ci && npm run build:layout`.
The compact rank index is derived from the installed graph during Pages
assembly and loaded only for ranked operations; pathfinding remains exact
and unaffected by display limits.

```js
await query('/api/generate', {
  artist: 'David Bowie', ranking: 'balanced', fraction: 0.4,
  decay: 0.5, depth: 2, maxBranch: 16, maxConnections: 100
});
```

The same parameters are exposed through MCP's `music_generate` tool.
The complete evidence and ordinary paginated neighbor API remain unchanged.
Path queries accept `limit: 1–10` and return `alternatives` containing other
equally short artist sequences, ranked primarily by popularity with small hub and repeated-intermediary penalties, and a modest bonus for direct musical roles.
The default API limit remains one. The browser requests six.
Autocomplete groups equal display names but never merges different artist IDs;
`expand: true` exposes individual identities and disambiguation. Immutable
data resources use browser caching, and up to 64 small validated range reads
are cached per snapshot. A failed range read is retried once.

### Read-only MCP

```sh
npm ci
npm run mcp
```

Configure a local MCP client with command `node` and argument
`/absolute/path/to/MusicAtlas/mcp.mjs`. Tools: `music_stats`,
`music_search`, `music_path`, `music_neighbors`, `music_evidence`, `music_profile`.
The official SDK provides stdio transport, using the same lazy static client
as the website. No credentials or writes. Pages itself cannot host a dynamic
MCP transport.

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
`python3 scripts/schema.py`. Existing RDF predicates remain compatible. The original SevenDegrees namespace is intentionally retained as a stable identifier; renaming the project does not invalidate existing RDF data.

### Build and publish

```sh
# Local seed fixture and HTTP range regression tests
scripts/pages.sh .cache/pages
node scripts/pages-test.js .cache/pages

# Full static index (requires the canonical bulk corpus and graph projection)
bulk=bulk/20261125-002239
./degrees -db "$bulk/graph.sqlite" export-static | gzip -n -6 > .cache/full/graph.json.gz
uv run --no-project --with orjson==3.11.4 scripts/static-index.py \
  .cache/full/graph.json.gz .cache/range/full --seed "$bulk/seed" \
  --bulk "$bulk/shards" --stats "$bulk/stats.txt"
scripts/publish-range.sh .cache/range/full

# Assemble Pages from the verified release asset
PAGES_RELEASE=corpus-mb-20261125-002239 scripts/pages.sh .cache/pages
```

Publication verifies exact round-trip and incidence, checks the full archive
size, and exercises the HTTP range client before uploading the static index
and SHA256. Actions verifies the archive digest and deploys immutable
versioned files. The build archive is downloaded by CI, never by the browser.

### People, bands and portable OWL

The MusicBrainz core dump contains 2,359,441 typed artist profiles and 815,274
professional relationship assertions in the selected musical relationship types.
These include 665,920 band memberships; 164,661 have at least one date field.
The temporal source records retain partial dates, ended flags, attributes and
individual assertion IDs. Unknown dates do not establish active membership.
The web index currently includes 737,790 assertions whose endpoints both occur
in its 1,595,768-artist graph. The remaining entities and assertions are
retained for the portable OWL export. The original 7,744,208 canonical facts
remain available without loss. The corpus is not an exhaustive mirror of all
MusicBrainz tables or all music sources.

```sh
# Existing verified dump; recover typed entities and date-qualified relationships.
uv run --no-project --with orjson==3.11.4 scripts/people.py extract .cache/people \
  --archive "$bulk/mbdump.tar.bz2" --stage "$bulk/stage.sqlite"
# Build the sorted artist-name search index.
uv run --no-project --with orjson==3.11.4 \
  scripts/search-index.py .cache/full/graph.json.gz .cache/range/atlas --seed "$bulk/seed"
uv run --no-project --with orjson==3.11.4 scripts/people.py pack .cache/people --index .cache/range/atlas
./degrees -db "$bulk/graph.sqlite" export-static | gzip -n -5 > .cache/full/categories.json.gz
uv run --no-project --with orjson==3.11.4 scripts/topology.py .cache/full/categories.json.gz .cache/range/atlas
scripts/publish-range.sh .cache/range/atlas
```

The separate single-file OWL release is Turtle gzip (`MusicAtlas.ttl.gz`);
it embeds the ontology and source assertions without requiring remote imports.
The website consumes the independently built range index, not the OWL archive.

The browser deliberately exposes just two tools: Explore map and Find connections.
Selecting an autocomplete result fills the input; the submit button runs the query.
Filters apply on the next search, and evidence and membership panels load on demand.
Alternative chains remain above the map while individual artists are inspected.
Generation settings apply on change with a fixed seed; Shuffle explicitly advances
the seed. Candidate variation is keyed by edge identity. The draw count reports
when the caps bind. Appearance changes preserve the selected graph; force-layout
changes animate to deterministic 2D target positions. Generation changes rebuild
the root map, including replacing manually expanded branches.
