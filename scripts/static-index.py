#!/usr/bin/env python3
"""Build a range-addressable, lossless static graph index from the canonical corpus."""
import argparse
from array import array
from collections import defaultdict
import gzip
from itertools import zip_longest
import pathlib
import re
import unicodedata
import orjson

PACK_BYTES = 16 * 1024 * 1024
ARTISTS, EDGES, WITNESSES, FACTS, INCIDENCE = 128, 512, 128, 512, 256

def dump(value): return orjson.dumps(value)
def norm(value): return unicodedata.normalize("NFKC",value).lower().strip()
def prefix(value): return value[:2].encode().hex()
def tokens(value): return set([value,*re.split(r"\s+",value)])
def read_json(path):
    with gzip.open(path,"rb") as f: return orjson.loads(f.read())

class Pack:
    """Each member is independently gzipped. Index holds [pack, offset, size]."""
    def __init__(self,root,name):
        self.root,self.name=root,name
        self.index=[];self.files=[];self.handle=None;self.size=0
    def add(self,value):
        b=gzip.compress(dump(value),compresslevel=5,mtime=0)
        if self.handle is None or self.size+len(b)>PACK_BYTES:
            if self.handle:self.handle.close()
            p=self.root/f"{self.name}-{len(self.files):03}.bin"
            self.files.append(p.name);self.handle=p.open("wb");self.size=0
        self.index.append([len(self.files)-1,self.size,len(b)])
        self.handle.write(b);self.size+=len(b)
    def finish(self):
        if self.handle:self.handle.close()
        path=self.root/f"{self.name}.index.json.gz"
        path.write_bytes(gzip.compress(dump(self.index),mtime=0))
        return {"index":path.name,"packs":self.files,"blocks":len(self.index)}

def chunks(values,n):
    for i in range(0,len(values),n): yield values[i:i+n]

def source_facts(seed,bulk):
    # Bulk facts have already been deduplicated by stable ID. They supersede
    # overlapping seed facts in the canonical SQLite import order.
    seeds={}
    for path in sorted(seed.glob("*.jsonl")):
        for line in path.open("rb"):
            f=orjson.loads(line);seeds[f["id"]]=f
    for path in bulk:
        with gzip.open(path,"rb") as src:
            for line in src:
                f=orjson.loads(line);seeds.pop(f["id"],None);yield f
    yield from seeds.values()

def build(graph,root,seed,bulk,expected):
    root.mkdir(parents=True,exist_ok=True)
    sections={}
    def finish(p,block=None):
        sections[p.name]=p.finish()
        if block:sections[p.name]["block_size"]=block
    print("loading graph projection",flush=True)
    g=read_json(graph)
    artists=g.pop("artists");evidence=g.pop("evidence");strings=g.pop("strings")
    offsets=array("I",g.pop("offsets"));adj=array("I",g.pop("adjacency"))
    count=g["facts"]
    assert len(offsets)==len(artists)+1 and offsets[-1]==len(adj)
    assert len(artists)==expected["artist"] and count==expected["fact"]
    ids={a["id"]:i for i,a in enumerate(artists)}
    assert len(ids)==len(artists)
    priority=orjson.loads((seed/"priority.json").read_bytes()) if (seed/"priority.json").exists() else {"artists":[]}
    ranks={a.get("artist_mbid"):i for i,a in enumerate(priority["artists"])}
    metadata=Pack(root,"artist")
    for block in chunks(artists,ARTISTS):metadata.add(block)
    finish(metadata,ARTISTS)
    # Artist blocks are in ID order; the sparse directory resolves MBIDs.
    starts=[artists[i]["id"] for i in range(0,len(artists),ARTISTS)]
    assert all(a<b for a,b in zip(starts,starts[1:]))
    print("artist index",len(artists),flush=True)
    # Name and token-prefix index. Store complete names/aliases, not a ranked truncation.
    # One-character keys cover exact single-character names.
    buckets=defaultdict(list)
    for i,a in enumerate(artists):
        names=[a["name"],*a.get("aliases",[])]
        keys={prefix(t) for name in names for t in tokens(norm(name)) if t}
        row=[i,a["id"],a["name"],a.get("aliases",[]),ranks.get(a["id"],1000000)]
        for key in keys:buckets[key].append(row)
    search=Pack(root,"search");directory={}
    for key,rows in sorted(buckets.items()):
        # Split skewed prefixes into manageable independent blocks.
        first=len(search.index)
        for block in chunks(rows,2048):search.add(block)
        directory[key]=[first,len(search.index)-first]
    finish(search)
    del buckets
    print("name index",len(directory),flush=True)
    topo=Pack(root,"topology")
    for start in range(0,len(artists),EDGES):
        rows=[]
        for i in range(start,min(start+EDGES,len(artists))):
            row=adj[offsets[i]:offsets[i+1]]
            for j in range(1,len(row),2):
                w=row[j];row[j]=(w<<1)|evidence[w][3]
            rows.append(list(row))
        topo.add(rows)
    finish(topo,EDGES)
    print("topology",len(adj)//2,flush=True)
    witness=Pack(root,"witness")
    for block in chunks(evidence,WITNESSES):
        witness.add([[strings[k],strings[t],strings[s]] for k,t,s,_ in block])
    finish(witness,WITNESSES)
    directed=len(adj)//2
    del adj,offsets,evidence,strings
    # Preserve all canonical fact IDs, kinds, titles, sources and participant roles.
    # Numeric IDs replace repeated artist UUIDs; original names retained if different.
    incidence=[None]*len(artists)
    fact=Pack(root,"fact");batch=[];n=participants=0
    for f in source_facts(seed,bulk):
        people=[];seen=set()
        for a in f["participants"]:
            i=ids[a["id"]];row=[i,a["role"]]
            if a["name"]!=artists[i]["name"]:row.append(a["name"])
            people.append(row)
            if i not in seen:
                if incidence[i] is None:incidence[i]=array("I")
                incidence[i].append(n);seen.add(i)
        participants+=len(people)
        batch.append([f["id"],f["kind"],f["title"],f["source"],people])
        n+=1
        if len(batch)==FACTS:fact.add(batch);batch=[]
        if n%500000==0:print("facts",n,flush=True)
    if batch:fact.add(batch)
    finish(fact,FACTS)
    assert n==count,(n,count)
    assert participants==expected["participant"],(participants,expected["participant"])
    inv=Pack(root,"incidence")
    for block in chunks(incidence,INCIDENCE):
        inv.add([list(row) if row is not None else [] for row in block])
    finish(inv,INCIDENCE)
    stats={**expected,"directed_edges":directed}
    manifest={"api_version":1,"layout":"range-v1","stats":stats,
              "sections":sections,"artist_starts":starts,"search_directory":directory,
              "full_corpus":"https://github.com/cheeseonamonkey/MusicAtlas/releases/tag/corpus-mb-20261125-002239"}
    (root/"manifest.json").write_bytes(dump(manifest))
    (root/"stats.json").write_bytes(dump(stats))
    total=sum(p.stat().st_size for p in root.iterdir())
    print("complete",stats,"bytes",total,flush=True)
    assert total<950*1024*1024,"Pages size budget exceeded"

def verify(root,seed,bulk,expected):
    """Decode every canonical fact and verify its exact round-trip and incidence."""
    m=orjson.loads((root/"manifest.json").read_bytes())
    assert all(m["stats"][k]==v for k,v in expected.items())
    def read_blocks(section):
        d=m["sections"][section]
        index=read_json(root/d["index"])
        handle=None;current=-1
        try:
            for pack,offset,size in index:
                if pack!=current:
                    if handle:handle.close()
                    handle=(root/d["packs"][pack]).open("rb");current=pack
                handle.seek(offset)
                yield orjson.loads(gzip.decompress(handle.read(size)))
        finally:
            if handle:handle.close()
    artists=[a for block in read_blocks("artist") for a in block]
    assert len(artists)==expected["artist"]
    incidence=[None]*len(artists)
    encoded=(f for block in read_blocks("fact") for f in block)
    n=participants=0
    for f,raw in zip_longest(encoded,source_facts(seed,bulk)):
        assert f is not None and raw is not None, "fact count mismatch"
        fid,kind,title,source,people=f
        reconstructed=[];seen=set()
        for i,role,*names in people:
            a=artists[i]
            reconstructed.append({"id":a["id"],"name":names[0] if names else a["name"],"role":role})
            if i not in seen:
                if incidence[i] is None:incidence[i]=array("I")
                incidence[i].append(n);seen.add(i)
        assert {"id":fid,"kind":kind,"title":title,"source":source,"participants":reconstructed}==raw, ("fact differs",fid)
        n+=1;participants+=len(people)
        if n%1000000==0:print("round-trip verified",n,flush=True)
    assert n==expected["fact"] and participants==expected["participant"]
    i=0
    for block in read_blocks("incidence"):
        for row in block:
            assert row==(list(incidence[i]) if incidence[i] is not None else []), ("incidence differs",i)
            i+=1
    assert i==expected["artist"]
    print("verified exact round-trip and incidence",n,participants,i,flush=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("graph",type=pathlib.Path);p.add_argument("output",type=pathlib.Path)
    p.add_argument("--seed",type=pathlib.Path,default=pathlib.Path("corpus"))
    p.add_argument("--bulk",type=pathlib.Path)
    p.add_argument("--stats",type=pathlib.Path,required=True)
    p.add_argument("--verify",action="store_true")
    args=p.parse_args()
    expected={k:int(v) for k,v in (l.split(": ") for l in args.stats.read_text().splitlines())}
    bulk=[] if not args.bulk else sorted(args.bulk.glob("priority-*.jsonl.gz"))+sorted(args.bulk.glob("longtail-*.jsonl.gz"))
    if args.verify:verify(args.output,args.seed,bulk,expected)
    else:build(args.graph,args.output,args.seed,bulk,expected)
if __name__=="__main__":main()
