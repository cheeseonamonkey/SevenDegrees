"""Split a completed gzip stream into bounded release assets without recompressing it."""
import hashlib
import json
import pathlib
import sys
import ijson

src,output=map(pathlib.Path,sys.argv[1:3])
output.mkdir(parents=True,exist_ok=True)
import gzip
stats={"artist":0,"fact":0,"directed_edges":0}
with gzip.open(src,"rb") as f:
    for key,event,value in ijson.parse(f):
        if key=="artists.item" and event=="start_map":stats["artist"]+=1
        elif key=="adjacency.item" and event=="number":stats["directed_edges"]+=1
        elif key=="facts" and event=="number":stats["fact"]=value
stats["directed_edges"]//=2
if not stats["artist"] or not stats["fact"]:raise ValueError("empty graph")
parts=[]
with src.open("rb") as f:
    while block:=f.read(32*1024*1024):
        name=f"web-full-{len(parts):03}.gzpart"
        (output/name).write_bytes(block)
        parts.append({"name":name,"bytes":len(block),"sha256":hashlib.sha256(block).hexdigest()})
manifest={"bytes":src.stat().st_size,"stats":stats,"parts":parts}
(output/"web-full-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps(stats),len(parts),"parts",flush=True)
