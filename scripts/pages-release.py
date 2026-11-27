"""Retrieve published graph sources and verify all asset checksums."""
import hashlib
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

release,output=sys.argv[1],pathlib.Path(sys.argv[2])
if not re.fullmatch(r"corpus-mb-\d{8}-\d{6}",release):
    raise ValueError("invalid release tag")
base="https://github.com/cheeseonamonkey/SevenDegrees/releases/download/"+release+"/"

def download(name, optional=False):
    request=urllib.request.Request(base+name,headers={"User-Agent":"SevenDegrees-Pages"})
    try:
        r=urllib.request.urlopen(request,timeout=120)
    except urllib.error.HTTPError as e:
        if optional and e.code==404:return None
        raise
    with r, (output/name).open("wb") as f:
        while chunk:=r.read(1024*1024): f.write(chunk)
    return output/name

def checked(file,pattern):
    if not re.fullmatch(pattern,file["name"]):raise ValueError("invalid asset name")
    path=download(file["name"])
    with path.open("rb") as f:digest=hashlib.file_digest(f,"sha256").hexdigest()
    if path.stat().st_size!=file["bytes"] or digest!=file["sha256"]:
        raise ValueError("corrupt "+path.name)
    print("verified",path.name,flush=True)
    return path

manifest=json.loads(download("manifest.json").read_text())
files=[f for f in manifest["files"] if re.fullmatch(r"priority-\d+\.jsonl\.gz",f["name"])]
if not files:raise ValueError("no priority shards")
for file in files:checked(file,r"priority-\d+\.jsonl\.gz")
download("stats.txt")
full=download("web-full-manifest.json",optional=True)
if full:
    m=json.loads(full.read_text())
    for file in m["parts"]:checked(file,r"web-full-\d+\.gzpart")
