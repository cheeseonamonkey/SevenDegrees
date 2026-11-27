"""Fetch a pinned static index release and verify the complete archive."""
import hashlib
import pathlib
import re
import sys
import urllib.request

release,output=sys.argv[1],pathlib.Path(sys.argv[2])
if not re.fullmatch(r"corpus-mb-\d{8}-\d{6}",release):
    raise ValueError("invalid release tag")
base="https://github.com/cheeseonamonkey/MusicAtlas/releases/download/"+release+"/"
def download(name):
    request=urllib.request.Request(base+name,headers={"User-Agent":"MusicAtlas-Pages"})
    with urllib.request.urlopen(request,timeout=120) as r,(output/name).open("wb") as f:
        while chunk:=r.read(1024*1024):f.write(chunk)
    return output/name
expected=download("web-range-index.sha256").read_text().split()[0]
path=download("web-range-index.tar")
with path.open("rb") as f:digest=hashlib.file_digest(f,"sha256").hexdigest()
if digest!=expected:raise ValueError("static index checksum mismatch")
print("verified",path.name,path.stat().st_size,flush=True)
