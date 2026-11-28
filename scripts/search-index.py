"""Build the sorted artist-name prefix index."""
import argparse
from collections import defaultdict
from pathlib import Path
import gzip
import orjson
# Reuse the exact static pack format without creating a competing data API.
from importlib import import_module
index=import_module("static-index")

def build(graph,root,seed):
    m=orjson.loads((root/"manifest.json").read_bytes())
    g=index.read_json(graph);artists=g.pop("artists")
    del g
    priority=orjson.loads((seed/"priority.json").read_bytes())
    ranks={a["artist_mbid"]:i for i,a in enumerate(priority["artists"]) if a.get("artist_mbid")}
    print("sorting name index",flush=True)
    # Sorted suffixes at word boundaries enable exact prefix interval lookup.
    # Each row keeps artist ordinal, stable ID, display name and full-name flag.
    entries=[]
    for i,a in enumerate(artists):
        terms={}
        for name in [a["name"],*a.get("aliases",[])]:
            name=index.norm(name);words=name.split()
            if not name:continue
            terms[name]=True
            for j in range(1,len(words)):terms.setdefault(" ".join(words[j:]),False)
        for term,full in terms.items():
            entries.append((term,i,a["id"],a["name"],ranks.get(a["id"],1000000),int(full)))
    # UTF-16 order is shared with JavaScript's native string comparisons.
    entries.sort(key=lambda e:e[0].encode("utf-16-be"))
    for p in root.glob("search-*.bin"):p.unlink()
    for p in root.glob("search-directory-*.json.gz"):p.unlink()
    p=index.Pack(root,"search");directory=defaultdict(list)
    # Each first-codepoint directory contains block boundaries, not every name.
    for first,group in __import__("itertools").groupby(entries,key=lambda e:e[0][0]):
        key=first.encode().hex();rows=list(group)
        for block in index.chunks(rows,256):
            directory[key].append([block[0][0],block[-1][0],len(p.index)])
            p.add(block)
    files={}
    for key,rows in directory.items():
        name="search-directory-"+key+".json.gz"
        (root/name).write_bytes(gzip.compress(orjson.dumps(rows),mtime=0));files[key]=name
    m["sections"]["search"]=p.finish()
    m["search_directory"]=files
    m["search_layout"]="sorted-prefix-v1"
    print("search entries",len(entries),"directories",len(files),flush=True)
    old=m.pop("atlas",None)
    if old:(root/old).unlink(missing_ok=True)
    (root/"manifest.json").write_bytes(orjson.dumps(m))

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("graph",type=Path);p.add_argument("root",type=Path);p.add_argument("--seed",type=Path,default=Path("corpus"))
    a=p.parse_args();build(a.graph,a.root,a.seed)
