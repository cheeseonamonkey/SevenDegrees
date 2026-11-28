"""Derive compact generation-only ranking data from the installed topology."""
import gzip
import hashlib
import json
from pathlib import Path

def blocks(root, section):
    with gzip.open(root / section["index"], "rt") as f:
        index = json.load(f)
    handle = None
    current = None
    try:
        for pack, offset, size in index:
            if pack != current:
                if handle: handle.close()
                handle = (root / section["packs"][pack]).open("rb")
                current = pack
            handle.seek(offset)
            yield json.loads(gzip.decompress(handle.read(size)))
    finally:
        if handle: handle.close()

def build(root, manifest):
    degrees = []
    for block in blocks(root, manifest["sections"]["topology"]):
        for row in block:
            degrees.append(len(set(row[::2])))
    assert len(degrees) == manifest["stats"]["artist"]
    # ListenBrainz chart ranks are independent of graph degree.
    chart = json.loads((Path(__file__).resolve().parents[1] / "corpus/priority.json").read_text())
    ranks = {a["artist_mbid"]: i for i, a in enumerate(chart["artists"]) if a.get("artist_mbid")}
    popular = {}
    i = 0
    for block in blocks(root, manifest["sections"]["artist"]):
        for artist in block:
            if artist["id"] in ranks: popular[i] = ranks[artist["id"]]
            i += 1
    data = gzip.compress(json.dumps({"degree":degrees,"popular":popular},separators=(",",":")).encode(),mtime=0)
    path = root / ("rank-" + hashlib.sha256(data).hexdigest()[:16] + ".json.gz")
    path.write_bytes(data)
    print("Generation rank index:",path.stat().st_size,"bytes,",len(popular),"charted artists")
    return path.name
