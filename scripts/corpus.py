"""Canonical relationship records in import precedence order."""
import gzip
import orjson

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
