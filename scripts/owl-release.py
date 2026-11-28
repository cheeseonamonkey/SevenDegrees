"""Stream one self-contained OWL knowledge graph in Turtle; no external imports."""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
from urllib.parse import quote
import orjson
from corpus import source_facts

ROOT=Path(__file__).resolve().parents[1]
NS="https://github.com/cheeseonamonkey/SevenDegrees/blob/main/ontology/music.ttl#"
RULES=json.loads((ROOT/"ontology/relations.json").read_text())
def lit(s): return json.dumps(s,ensure_ascii=False)
def iri(s): return "<"+quote(s,safe=":/?#[]@!$&'()*+,;=%~._-")+">"
def artist(id): return "artist:"+id if len(id)==36 and all(c in "0123456789abcdef-" for c in id) else iri(NS+"artist/"+quote(id,safe=""))
def fact_iri(id): return iri(NS+"fact/"+quote(id,safe=":@&=+$"))
def header():
    schema=(ROOT/"ontology/music.ttl").read_text()
    # Imported declarations are embedded instead, so loading the graph requires no network.
    schema=schema.replace(' ;\n  owl:imports <https://raw.githubusercontent.com/cheeseonamonkey/MusicAtlas/main/ontology/relationship-types.ttl> .',' .')
    return schema+"\n"+(ROOT/"ontology/relationship-types.ttl").read_text()+"""
@prefix artist: <https://musicbrainz.org/artist/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
sd:sourceID a owl:DatatypeProperty ; rdfs:range xsd:string .
sd:creditedName a owl:DatatypeProperty ; rdfs:domain sd:Participation ; rdfs:range xsd:string .
sd:position a owl:DatatypeProperty ; rdfs:domain sd:Participation ; rdfs:range xsd:nonNegativeInteger .
sd:artistID a owl:DatatypeProperty ; rdfs:domain sd:Artist ; rdfs:range xsd:string .
"""
def export(args):
    stats=Counter(); ids=set()
    with gzip.open(args.graph,"rb") as f: artists=orjson.loads(f.read())["artists"]
    with args.output.open("wb") as raw, gzip.GzipFile(fileobj=raw,mode="wb",compresslevel=6,mtime=0) as compressed:
        def write(s):compressed.write(s.encode())
        write(header())
        for a in artists:
            aliases=" ; skos:altLabel "+", ".join(map(lit,a["aliases"])) if a.get("aliases") else ""
            write(f"{artist(a['id'])} a sd:Artist ; sd:artistID {lit(a['id'])} ; rdfs:label {lit(a['name'])}{aliases} .\n")
            ids.add(a["id"]);stats["artist"]+=1
        del artists
        for f in source_facts(args.seed,sorted(args.bulk.glob("priority-*.jsonl.gz"))+sorted(args.bulk.glob("longtail-*.jsonl.gz")) if args.bulk else []):
            parts=[]; fid=fact_iri(f["id"])
            for pos,p in enumerate(f["participants"]):
                assert p["id"] in ids
                parts.append(f"[ a sd:Participation ; sd:artist {artist(p['id'])} ; sd:roleType sd:role-{p['role']} ; sd:role {lit(p['role'])} ; sd:creditedName {lit(p['name'])} ; sd:position \"{pos}\"^^xsd:nonNegativeInteger ]")
                stats["participant"]+=1
            extra=""
            pieces=f["id"].split(":")
            if len(pieces)==3 and pieces[:2]==["mb","recording"]:extra=" ; sd:describes "+iri("https://musicbrainz.org/recording/"+pieces[2])
            elif len(pieces)==4 and pieces[:2]==["mb","cover-reference"]:extra=" ; sd:describes "+iri("https://musicbrainz.org/recording/"+pieces[2])+" ; sd:referenceWork "+iri("https://musicbrainz.org/work/"+pieces[3])
            elif len(pieces)==4 and pieces[:2]==["mb","album-cover"]:extra=" ; sd:describes "+iri("https://musicbrainz.org/release-group/"+pieces[2])+" ; sd:referenceReleaseGroup "+iri("https://musicbrainz.org/release-group/"+pieces[3])
            write(f"{fid} a sd:Fact, sd:{RULES[f['kind']]['class']} ; sd:sourceID {lit(f['id'])} ; sd:kind {lit(f['kind'])} ; rdfs:label {lit(f['title'])} ; prov:wasDerivedFrom {iri(f['source'])}{extra} ; sd:participation "+", ".join(parts)+" .\n")
            stats["fact"]+=1
            if stats["fact"]%500000==0:print(dict(stats),flush=True)
    expected={k:int(v) for k,v in (l.split(": ") for l in args.stats.read_text().splitlines())}
    assert stats==expected,(stats,expected)
    print("export complete",dict(stats),args.output.stat().st_size,flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument("graph",type=Path);p.add_argument("output",type=Path)
    p.add_argument("--seed",type=Path,default=Path("corpus"));p.add_argument("--bulk",type=Path);p.add_argument("--stats",type=Path,required=True)
    export(p.parse_args())
if __name__=="__main__":main()
