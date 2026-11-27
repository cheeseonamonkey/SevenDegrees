#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
agent='SevenDegrees/0.1 (https://github.com/cheeseonamonkey/SevenDegrees)'
query() {
 curl -fsSG --retry 1 --max-time 30 -A "$agent" https://query.wikidata.org/sparql --data-urlencode "query=$1" -H 'Accept: application/sparql-results+json'
}
seeds=$(jq -r '.artists[:100][]|.artist_mbid // empty' corpus/priority.json | awk '{printf "\"%s\" ",$0}')
query "SELECT DISTINCT ?group ?groupID ?groupName ?member ?memberID ?memberName WHERE { VALUES ?seed { $seeds } ?group wdt:P434 ?seed; wdt:P527 ?member; rdfs:label ?groupName . BIND(?seed AS ?groupID) ?member wdt:P434 ?memberID; rdfs:label ?memberName . FILTER NOT EXISTS { ?group wdt:P434 ?otherGroup . FILTER(?otherGroup != ?groupID) } FILTER NOT EXISTS { ?member wdt:P434 ?otherMember . FILTER(?otherMember != ?memberID) } FILTER(LANG(?groupName)='en' && LANG(?memberName)='en') }" > "$tmp/members"
jq -ce '.results.bindings | map({id:("wd:member:"+(.group.value|split("/")|last)+":"+ .groupID.value+":"+ .memberID.value),kind:"membership",title:(.groupName.value+" membership"),source:(.group.value|sub("^http:";"https:")),participants:[{id:.groupID.value,name:.groupName.value,role:"group"},{id:.memberID.value,name:.memberName.value,role:"member"}]}) | unique_by(.id)[]' "$tmp/members" > "$tmp/members.jsonl"
# Only recordings explicitly classified as cover versions, with a linked original and credited performers.
query 'SELECT DISTINCT ?cover ?title ?original ?a ?aID ?aName ?b ?bID ?bName WHERE { ?cover wdt:P31 wd:Q155171; (wdt:P5059|wdt:P144) ?original; wdt:P175 ?a; rdfs:label ?title . ?original wdt:P175 ?b . ?a wdt:P434 ?aID; rdfs:label ?aName . ?b wdt:P434 ?bID; rdfs:label ?bName . FILTER NOT EXISTS { ?a wdt:P434 ?otherA . FILTER(?otherA != ?aID) } FILTER NOT EXISTS { ?b wdt:P434 ?otherB . FILTER(?otherB != ?bID) } FILTER(?a != ?b && ?aID != ?bID && LANG(?title)="en" && LANG(?aName)="en" && LANG(?bName)="en") } LIMIT 3000' > "$tmp/covers"
jq -ce '.results.bindings | map({id:("wd:cover:"+(.cover.value|split("/")|last)+":"+(.original.value|split("/")|last)+":"+ .aID.value+":"+ .bID.value),kind:"cover",title:.title.value,source:(.cover.value|sub("^http:";"https:")),participants:[{id:.aID.value,name:.aName.value,role:"performer"},{id:.bID.value,name:.bName.value,role:"original"}]}) | unique_by(.id)[]' "$tmp/covers" > "$tmp/covers.jsonl"

# Recording-level performers and producers only; exclude solo-only rows.
query 'SELECT DISTINCT ?track ?title ?artistID ?artistName ?role WHERE { ?track wdt:P4404 ?mb; wdt:P31 ?class; rdfs:label ?title . VALUES ?class { wd:Q7302866 wd:Q3302947 } VALUES (?property ?role) { (wdt:P175 "performer") (wdt:P162 "producer") } ?track ?property ?artist . ?artist wdt:P434 ?artistID; rdfs:label ?artistName . FILTER NOT EXISTS { ?artist wdt:P434 ?other . FILTER(?other != ?artistID) } FILTER(LANG(?title)="en" && LANG(?artistName)="en") } LIMIT 20000' > "$tmp/recordings"
jq -c '.results.bindings | group_by(.track.value)[] | {id:("wd:recording:"+(.[0].track.value|split("/")|last)),kind:"recording",title:.[0].title.value,source:(.[0].track.value|sub("^http:";"https:")),participants:(map({id:.artistID.value,name:.artistName.value,role:.role.value})|unique_by([.id,.role]))} | select((.participants|map(.id)|unique|length)>=2 and any(.participants[];.role=="performer") and (.participants|length)<=12)' "$tmp/recordings" > "$tmp/recordings.jsonl"
mv "$tmp/recordings.jsonl" corpus/wikidata-recordings.jsonl
mv "$tmp/members.jsonl" corpus/wikidata-membership.jsonl
mv "$tmp/covers.jsonl" corpus/wikidata-covers.jsonl
