#!/usr/bin/env python3
"""Generate OWL role/fact vocabulary and SHACL constraints from relationship rules."""
import argparse
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]/"ontology"
rules=json.loads((root/"relations.json").read_text())
roles=sorted({role for rule in rules.values() for role in rule["roles"]})
prefix="""@prefix sd: <https://github.com/cheeseonamonkey/SevenDegrees/blob/main/ontology/music.ttl#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
"""
def role(r): return "sd:role-"+r
def ttl_list(items): return "( "+" ".join(items)+" )"
def role_shape(group):
    return "[ sh:path sd:roleType ; sh:in "+ttl_list(map(role,group))+" ; sh:minCount 1 ]"
owl=[prefix, "<https://raw.githubusercontent.com/cheeseonamonkey/MusicAtlas/main/ontology/relationship-types.ttl> a owl:Ontology .", "sd:Role a owl:Class ; rdfs:subClassOf skos:Concept .",
     "sd:roleType a owl:ObjectProperty ; rdfs:domain sd:Participation ; rdfs:range sd:Role ."]
for r in roles: owl.append(f'{role(r)} a sd:Role, owl:NamedIndividual ; rdfs:label "{r}" .')
for kind,rule in rules.items():
    owl.append(f'sd:{rule["class"]} a owl:Class ; rdfs:subClassOf sd:Fact ; rdfs:label "{kind}" .')
owl.append("[] a owl:AllDisjointClasses ; owl:members "+ttl_list("sd:"+r["class"] for r in rules.values())+" .")
shapes=[prefix, """sd:FactShape a sh:NodeShape ;
  sh:targetClass sd:Fact ;
  sh:property [ sh:path rdfs:label ; sh:minCount 1 ; sh:datatype xsd:string ] ;
  sh:property [ sh:path prov:wasDerivedFrom ; sh:minCount 1 ; sh:nodeKind sh:IRI ] ;
  sh:property [ sh:path sd:participation ; sh:minCount 2 ; sh:node sd:FactParticipationShape ] .

sd:FactParticipationShape a sh:NodeShape ;
  sh:property [ sh:path sd:artist ; sh:minCount 1 ; sh:maxCount 1 ; sh:class sd:Artist ] ;
  sh:property [ sh:path sd:roleType ; sh:minCount 1 ; sh:maxCount 1 ; sh:in """+ttl_list(map(role,roles))+""" ] .
"""]
for kind,r in rules.items():
    props=["sh:targetClass sd:"+r["class"],
           'sh:property [ sh:path sd:kind ; sh:hasValue "'+kind+'" ]',
           "sh:property [ sh:path sd:participation ; sh:node [ sh:property "+role_shape(r["roles"])+" ] ]"]
    for group in r["required"]:
        props.append("sh:property [ sh:path sd:participation ; sh:qualifiedValueShape [ sh:property "+role_shape(group)+" ] ; sh:qualifiedMinCount 1"+(" ; sh:qualifiedMaxCount 1" if len(group)==1 and group[0] in r.get("single",[]) else "")+" ]")
    shapes.append("sd:"+r["class"]+"Shape a sh:NodeShape ;\n  "+" ;\n  ".join(props)+" .")
parser=argparse.ArgumentParser()
parser.add_argument("--check",action="store_true")
args=parser.parse_args()
for name,lines in [("relationship-types.ttl",owl),("shapes.ttl",shapes)]:
    path=root/name
    data="\n".join(lines)+"\n"
    if args.check:
        if path.read_text()!=data: raise SystemExit(f"stale generated ontology: {name}")
    else: path.write_text(data)
