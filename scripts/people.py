"""Recover typed artists and time-qualified musical relationships from the source dump."""
import argparse
from collections import Counter, defaultdict
import gzip
from importlib import import_module
from pathlib import Path
import sqlite3
import tarfile
import orjson
from bulk_relationships import decode
index=import_module("static-index")

# Preserve source relationship assertions, including repeated tenures. Do not
# assert that every group member was present at the same time.
MUSICAL={"member of band","collaboration","founder","subgroup","is person","artist rename","teacher","conductor position","artistic director","supporting musician","instrumental supporting musician","vocal supporting musician","artist-in-residence","composer-in-residence"}
def date(parts):
    return [int(x) if x is not None else None for x in parts] if any(x is not None for x in parts) else None

def extract(args):
    args.output.mkdir(parents=True,exist_ok=True)
    stage=sqlite3.connect(args.stage)
    types={i:name for i,name in stage.execute("SELECT id,name FROM link_type WHERE entity0='artist' AND entity1='artist'") if name in MUSICAL}
    artists={a[0]:a[1] for a in stage.execute("SELECT id,gid FROM artist")}
    links=defaultdict(list)
    for rid,l,a,b,t in stage.execute("SELECT r.id,r.link,r.a,r.b,l.type FROM l_artist_artist r JOIN link l ON l.id=r.link JOIN link_type t ON t.id=l.type WHERE t.entity0='artist' AND t.entity1='artist'"):
        if t in types and a!=b and a in artists and b in artists:links[l].append((rid,artists[a],artists[b],types[t]))
    attrs=defaultdict(list)
    for lid,attr in stage.execute("SELECT a.link,t.name FROM link_attribute a JOIN link_attribute_type t ON t.id=a.attribute"):
        if lid in links:attrs[lid].append(attr)
    stage.close()
    print("candidate musical statements",sum(map(len,links.values())),flush=True)
    artist_types={}
    seen=set()
    with gzip.open(args.output/"people.jsonl.gz","wt",encoding="utf-8",compresslevel=5) as profiles, gzip.open(args.output/"tenures.jsonl.gz","wt",encoding="utf-8",compresslevel=5) as assertions:
        with tarfile.open(args.archive,"r|bz2") as tar:
            for item in tar:
                table=Path(item.name).name
                if table not in {"artist","artist_type","link"} or table in seen or not item.isfile():continue
                print("reading",table,flush=True)
                n=0
                for raw in tar.extractfile(item):
                    p=raw.decode("utf-8").rstrip("\n").split("\t")
                    row=int(p[0])
                    if table=="artist_type":artist_types[row]=decode(p[1])
                    elif table=="artist":
                        if p[10]!=r"\N":
                            obj={"id":p[1],"type":int(p[10]),"disambiguation":decode(p[13]) or ""}
                            profiles.write(orjson.dumps(obj).decode()+"\n");n+=1
                    elif row in links:
                        begin=date([decode(x) for x in p[2:5]])
                        end=date([decode(x) for x in p[5:8]])
                        ended=p[10]=="t"
                        for rid,a,b,kind in links[row]:
                            obj={"id":"mb:artist-relationship:"+str(rid),"from":a,"to":b,"kind":kind,"begin":begin,"end":end,"ended":ended,"attributes":attrs[row],"source":"https://musicbrainz.org/artist/"+b+"/relationships"}
                            assertions.write(orjson.dumps(obj).decode()+"\n");n+=1
                seen.add(table);print("read",table,n,flush=True)
                if len(seen)==3:break
    assert seen=={"artist","artist_type","link"}
    (args.output/"types.json").write_bytes(orjson.dumps(artist_types,option=orjson.OPT_NON_STR_KEYS))
    print("complete",artist_types,flush=True)

def records(path):
    with gzip.open(path,"rb") as f:
        for line in f:yield orjson.loads(line)

def pack(args):
    root=args.index; m=orjson.loads((root/"manifest.json").read_bytes())
    meta=[a for block in index.read_blocks(root,m,"artist") for a in block]
    ids={a["id"]:i for i,a in enumerate(meta)}
    types=orjson.loads((args.output/"types.json").read_bytes());profiles={}
    for a in records(args.output/"people.jsonl.gz"):
        if a["id"] in ids:profiles[ids[a["id"]]]=[types[str(a["type"])],a["disambiguation"]]
    for section in ("profile","timeline"):
        for old in root.glob(section+"-*.bin"):old.unlink()
    p=index.Pack(root,"profile")
    for start in range(0,len(meta),256):p.add([profiles.get(i,["Unknown",""]) for i in range(start,min(start+256,len(meta)))])
    m["sections"]["profile"]={**p.finish(),"block_size":256}
    timeline=defaultdict(list);count=Counter()
    for r in records(args.output/"tenures.jsonl.gz"):
        if r["from"] not in ids or r["to"] not in ids:continue
        a,b=ids[r["from"]],ids[r["to"]]
        data=[r["id"],r["kind"],r["begin"],r["end"],r["ended"],r["attributes"],r["source"]]
        timeline[a].append([b,"out",*data]);timeline[b].append([a,"in",*data]);count[r["kind"]]+=1
    p=index.Pack(root,"timeline")
    for start in range(0,len(meta),128):p.add([timeline.get(i,[]) for i in range(start,min(start+128,len(meta)))])
    m["sections"]["timeline"]={**p.finish(),"block_size":128}
    m["people_stats"]={"typed_artists":len(profiles),"musical_statements":sum(count.values()),"relationship_types":dict(count)}
    (root/"manifest.json").write_bytes(orjson.dumps(m))
    print(m["people_stats"],flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument("mode",choices=["extract","pack"]);p.add_argument("output",type=Path)
    p.add_argument("--stage",type=Path);p.add_argument("--archive",type=Path);p.add_argument("--index",type=Path)
    a=p.parse_args();(extract if a.mode=="extract" else pack)(a)
if __name__=="__main__":main()
