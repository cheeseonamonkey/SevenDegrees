"""Synchronize the browser vocabulary with the canonical relationship categories."""
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
p=root/"web/relationships.js"
s=p.read_text()
a=s.index("const relationshipTypes=");b=s.index("\nconst category=",a)
expected=s[:a]+"const relationshipTypes="+(root/"ontology/categories.json").read_text().strip()+";"+s[b:]
if "--check" in sys.argv:
    if expected!=s:raise SystemExit("relationship vocabulary drift; run scripts/relationship-schema.py")
else:p.write_text(expected)
