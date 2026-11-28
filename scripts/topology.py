"""Replace traversal projection with category-specific witnesses and temporal links."""
import argparse
from array import array

from importlib import import_module
from pathlib import Path
import orjson
index=import_module("static-index")

def build(graph,root):
    m=orjson.loads((root/"manifest.json").read_bytes())
    g=index.read_json(graph);assert g["version"]==3
    artists=g.pop("artists");evidence=g.pop("evidence");strings=g.pop("strings")
    offsets=array("I",g.pop("offsets"));adj=array("I",g.pop("adjacency"))
    assert len(artists)==m["stats"]["artist"] and g["facts"]==m["stats"]["fact"]
    assert all(a["id"]==b["id"] for a,b in zip(artists,(a for block in index.read_blocks(root,m,"artist") for a in block)))
    cats=orjson.loads((Path(__file__).resolve().parents[1]/"ontology/categories.json").read_bytes())
    bits={k:c["bit"] for c in cats.values() for k in c["kinds"]}
    # Timeline rows are independent evidence assertions, not collapsed facts.
    # Integrate one witness per category per pair, including professional links.
    extra={}
    additions={}
    if "timeline" in m["sections"]:
        for start,block in enumerate(index.read_blocks(root,m,"timeline")):
            for j,row in enumerate(block):
                src=start*m["sections"]["timeline"]["block_size"]+j
                for dest,direction,rid,kind,begin,end,ended,attrs,source in row:
                    bit=bits.get(kind,0)
                    if not bit:continue
                    if rid not in extra:
                        extra[rid]=len(evidence)+len(extra)
                        additions[extra[rid]]=[kind,kind,source]
    # Read the timeline again in lockstep with the topology blocks; no full extra adjacency map.
    timeline=(row for block in index.read_blocks(root,m,"timeline") for row in block) if "timeline" in m["sections"] else iter(())
    for name in ("topology","witness"):
        for old in root.glob(name+"-*.bin"):old.unlink()
    topo=index.Pack(root,"topology");directed=0
    for start in range(0,len(artists),index.EDGES):
        block=[]
        for i in range(start,min(start+index.EDGES,len(artists))):
            row=adj[offsets[i]:offsets[i+1]]
            pairs={(row[j],evidence[row[j+1]][3]):row[j+1] for j in range(0,len(row),2)}
            for dest,_,rid,kind,*_ in next(timeline,[]):
                bit=bits.get(kind,0)
                if bit:pairs.setdefault((dest,bit),extra[rid])
            values=[]
            for (dest,bit),w in sorted(pairs.items()):values.extend((dest,(w<<5)|bit))
            directed+=len(pairs);block.append(values)
        topo.add(block)
    witness=index.Pack(root,"witness")
    from itertools import chain,islice
    entries=chain(([strings[k],strings[t],strings[s]] for k,t,s,_ in evidence),(additions[i] for i in range(len(evidence),len(evidence)+len(extra))))
    while block:=list(islice(entries,index.WITNESSES)):witness.add(block)
    m["sections"]["topology"]={**topo.finish(),"block_size":index.EDGES}
    m["sections"]["witness"]={**witness.finish(),"block_size":index.WITNESSES}
    m["edge_encoding"]="category-v1";m["categories"]=cats;m["stats"]["directed_edges"]=directed
    (root/"manifest.json").write_bytes(orjson.dumps(m));print("typed topology",directed,"directed links",len(extra),"temporal witnesses",flush=True)
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("graph",type=Path);p.add_argument("root",type=Path);a=p.parse_args();build(a.graph,a.root)
