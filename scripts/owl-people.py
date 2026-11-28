"""Append recovered artist types and temporal relationships to the single OWL release."""
import argparse
from collections import Counter
import gzip
from importlib import import_module
from pathlib import Path
import sqlite3
import orjson
from people import records
owl=import_module("owl-release")
def export(base,output,source,stage):
    types=orjson.loads((source/"types.json").read_bytes())
    db=sqlite3.connect(stage)
    # All typed artists and all temporal endpoints belong to the portable graph.
    names=dict(db.execute("SELECT gid,name FROM artist"))
    db.close()
    counts=Counter()
    with base.open("rb") as src,output.open("wb") as dst:
        import shutil
        shutil.copyfileobj(src,dst)
    with gzip.open(output,"at",encoding="utf-8",compresslevel=6) as out:
        out.write("\n"+(owl.ROOT/"ontology/temporal.ttl").read_text()+"\n")
        out.write("@prefix artist: <https://musicbrainz.org/artist/> .\n")
        for p in records(source/"people.jsonl.gz"):
            typ=types[str(p["type"])];a=owl.artist(p["id"])
            cls=typ if typ in {"Person","Group","Orchestra","Choir","Character"} else "Artist"
            out.write(f"{a} a sd:{cls} ; sd:sourceType {owl.lit(typ)} ; sd:artistID {owl.lit(p['id'])} ; rdfs:label {owl.lit(names[p['id']])}")
            if p["disambiguation"]:out.write(" ; sd:disambiguation "+owl.lit(p["disambiguation"]))
            out.write(" .\n");counts["typed_artists"]+=1
        for r in records(source/"tenures.jsonl.gz"):
            s=owl.fact_iri(r["id"]);cls="MembershipAssertion" if r["kind"]=="member of band" else "ProfessionalRelationship"
            for id in (r["from"],r["to"]):
                out.write(f"{owl.artist(id)} a sd:Artist ; sd:artistID {owl.lit(id)} ; rdfs:label {owl.lit(names[id])} .\n")
            out.write(f"{s} a sd:{cls}, sd:ProfessionalRelationship ; sd:sourceID {owl.lit(r['id'])} ; sd:subjectArtist {owl.artist(r['from'])} ; sd:objectArtist {owl.artist(r['to'])} ; sd:relationshipKind {owl.lit(r['kind'])} ; sd:ended {str(r['ended']).lower()} ; prov:wasDerivedFrom {owl.iri(r['source'])}")
            for key in ("begin","end"):
                for suffix,value in zip(("Year","Month","Day"),r[key] or []):
                    if value is not None:out.write(f" ; sd:{key}{suffix} {value}")
            for a in r["attributes"]:out.write(" ; sd:attribute "+owl.lit(a))
            out.write(" .\n");counts["professional_assertions"]+=1
            if cls=="MembershipAssertion":counts["membership_assertions"]+=1
    print(dict(counts),output.stat().st_size,flush=True)
    assert counts["professional_assertions"]==815274 and counts["typed_artists"]==2359441
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("base","output","source","stage"):p.add_argument(name,type=Path)
    a=p.parse_args();export(a.base,a.output,a.source,a.stage)
