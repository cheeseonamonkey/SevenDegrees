"""Derive a navigable overview and sorted prefix index from the full graph."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path
import gzip
import heapq
import random
import numpy as np
import igraph as ig
import orjson
# Reuse the exact static pack format without creating a competing data API.
from importlib import import_module
index=import_module("static-index")

def build(graph,root,seed):
    m=orjson.loads((root/"manifest.json").read_bytes())
    g=index.read_json(graph);artists=g.pop("artists")
    offsets=np.asarray(g.pop("offsets"),dtype=np.int64)
    adj=np.asarray(g.pop("adjacency"),dtype=np.int64)[::2]
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
    del entries,directory
    # Undirected edges, with duplicate policy classes collapsed by simplify.
    src=np.repeat(np.arange(len(artists),dtype=np.int32),np.diff(offsets)//2)
    mask=src<adj
    edges=np.column_stack((src[mask],adj[mask])).astype(np.int32)
    del src,adj,offsets,mask
    print("constructing graph",edges.shape,flush=True)
    network=ig.Graph(n=len(artists),edges=edges,directed=False)
    del edges
    network.simplify()
    ig.set_random_number_generator(random.Random(42))
    print("Leiden community analysis",network.vcount(),network.ecount(),flush=True)
    membership=np.asarray(network.community_leiden(objective_function="modularity",resolution=1,n_iterations=2).membership,dtype=np.int32)
    counts=Counter(membership.tolist());selected=[c for c,_ in counts.most_common(100)]
    positions={c:i for i,c in enumerate(selected)}
    degrees=network.degree()
    # All communities remain represented in counts. The 100 largest are
    # rendered; other artists are discoverable through the complete name index.
    reps=defaultdict(list)
    for i,c in enumerate(membership):
        if c not in positions:continue
        a=artists[i];rank=ranks.get(a["id"],1000000)
        item=(-rank,degrees[i],i)
        h=reps[c]
        if len(h)<16:heapq.heappush(h,item)
        elif item>h[0]:heapq.heapreplace(h,item)
    communities=[]
    for c in selected:
        reps_for=[artists[i] for _,_,i in sorted(reps[c],reverse=True)]
        communities.append({"id":"c"+str(positions[c]),"name":reps_for[0]["name"],"size":counts[c],"artists":[{"id":a["id"],"name":a["name"]} for a in reps_for]})
    # Aggregate observed cross-community edges rather than inventing links.
    links=Counter()
    for batch in index.chunks(network.get_edgelist(),100000):
        for a,b in batch:
            x,y=membership[a],membership[b]
            if x!=y and x in positions and y in positions:
                links[tuple(sorted((positions[x],positions[y])))]+=1
    overview={"nodes":communities,"links":[{"source":"c"+str(a),"target":"c"+str(b),"weight":w} for (a,b),w in links.most_common(400)],"communities":len(counts),"shown_artists":sum(c["size"] for c in communities),"total_artists":len(artists),"algorithm":"Leiden modularity; 100 largest communities, 400 strongest inter-community links"}
    (root/"atlas.json.gz").write_bytes(gzip.compress(orjson.dumps(overview),mtime=0))
    m["atlas"]="atlas.json.gz"
    (root/"manifest.json").write_bytes(orjson.dumps(m))
    print("atlas",len(counts),"communities",overview["shown_artists"],"artists",len(overview["links"]),"links",flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("graph",type=Path);p.add_argument("root",type=Path);p.add_argument("--seed",type=Path,default=Path("corpus"))
    a=p.parse_args();build(a.graph,a.root,a.seed)
