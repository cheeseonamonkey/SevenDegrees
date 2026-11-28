"""Publish an immutable snapshot under a versioned relative path."""
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
import tarfile
from importlib import import_module

src,api=map(pathlib.Path,sys.argv[1:3])
api.mkdir(parents=True,exist_ok=True)
if src.is_file():
    with src.open("rb") as f:version=hashlib.file_digest(f,"sha256").hexdigest()[:20]
    dest=api/"data"/version
    dest.mkdir(parents=True,exist_ok=True)
    with tarfile.open(src) as tar:tar.extractall(dest,filter="data")
else:
    # Local test snapshots derive their identity from every packed file.
    digest=hashlib.sha256()
    for p in sorted(src.iterdir()):
        if p.is_file():
            with p.open("rb") as f:digest.update(hashlib.file_digest(f,"sha256").digest())
    version=digest.hexdigest()[:20];dest=api/"data"/version
    shutil.copytree(src,dest,dirs_exist_ok=True)
m=json.loads((dest/"manifest.json").read_text())
assert m["layout"]=="range-v1"
prefix="data/"+version+"/"
m["ranking"]=prefix+import_module("rank-index").build(dest,m)
if m.get("search_layout")=="sorted-prefix-v1":
    m["search_directory"]={k:prefix+v for k,v in m["search_directory"].items()}
old=m.pop("atlas",None)
if old:(dest/old).unlink(missing_ok=True)
for key in ("artist_starts","search_directory"):
    name=key+".json.gz"
    if key in m:
        (dest/name).write_bytes(gzip.compress(json.dumps(m.pop(key),separators=(",",":")).encode(),mtime=0))
    m[key]=prefix+name
for s in m["sections"].values():
    s["index"]=prefix+s["index"]
    s["packs"]=[prefix+p for p in s["packs"]]
m["snapshot"]=version
m["relations"]="relations.json"
m["ontology"]="ontology/music.ttl"
(api/"manifest.json").write_text(json.dumps(m,separators=(",",":"))+"\n")
(api/"stats.json").write_text(json.dumps(m["stats"])+"\n")
