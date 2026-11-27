#!/usr/bin/env python3
"""Build relationship-only facts from the MusicBrainz CC0 PostgreSQL COPY dump."""
import argparse
import collections
import gzip
import itertools
import hashlib
import json
import pathlib
import re
import sqlite3
import tarfile
import unicodedata

# Only fields needed for relationship evidence; no full discographies or releases.
TABLES = {
    "artist": ("id INTEGER PRIMARY KEY,gid TEXT,name TEXT", (0, 1, 2)),
    "artist_credit_name": ("credit INTEGER,pos INTEGER,artist INTEGER,phrase TEXT", (0, 1, 2, 4)),
    "recording": ("id INTEGER PRIMARY KEY,gid TEXT,title TEXT,credit INTEGER", (0, 1, 2, 3)),
    "link": ("id INTEGER PRIMARY KEY,type INTEGER", (0, 1)),
    "link_type": ("id INTEGER PRIMARY KEY,entity0 TEXT,entity1 TEXT,name TEXT,phrase TEXT", (0, 4, 5, 6, 8)),
    "l_artist_artist": ("id INTEGER PRIMARY KEY,link INTEGER,a INTEGER,b INTEGER", (0, 1, 2, 3)),
    "release_group": ("id INTEGER PRIMARY KEY,gid TEXT,title TEXT,credit INTEGER", (0, 1, 2, 3)),
    "l_release_group_release_group": ("id INTEGER PRIMARY KEY,link INTEGER,a INTEGER,b INTEGER", (0, 1, 2, 3)),
    "work": ("id INTEGER PRIMARY KEY,gid TEXT,title TEXT", (0, 1, 2)),
    "l_recording_work": ("id INTEGER PRIMARY KEY,link INTEGER,recording INTEGER,work INTEGER", (0, 1, 2, 3)),
    "link_attribute": ("link INTEGER,attribute INTEGER", (0, 1)),
    "link_attribute_type": ("id INTEGER PRIMARY KEY,gid TEXT,name TEXT", (0, 4, 5)),
    "l_artist_recording": ("id INTEGER PRIMARY KEY,link INTEGER,artist INTEGER,recording INTEGER", (0, 1, 2, 3)),
}
UUID = re.compile(r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
FEATURE = re.compile(r"\b(feat\.?|featuring|ft\.?)\b", re.I)
EXCLUDED = {"89ad4ac3-39f7-470e-963a-56509c546377", "125ec42a-7229-4250-afc5-e057484327fe", "33cf029c-63b0-41a0-9855-be2a3665fb3b"}
# PostgreSQL COPY text escapes; unescape after splitting tabs.
ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}
COPY_ESCAPE = re.compile(r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)")
def decode(value):
    if value == r"\N":
        return None
    def sub(m):
        s=m[1]
        if s.startswith("x") and len(s)>1: return chr(int(s[1:],16))
        if s[0] in "01234567": return chr(int(s,8))
        return ESCAPES.get(s,s)
    return COPY_ESCAPE.sub(sub,value)

def key(s):
    return " ".join(unicodedata.normalize("NFKC", s).casefold().split())

def actor(gid, name, role):
    if not gid or not UUID.fullmatch(gid) or gid in EXCLUDED or not name or key(name) in {
        "[unknown]", "[anonymous]", "[no artist]", "various artists", "[various artists]"
    }: return None
    return {"id":gid,"name":name,"role":role}

def normalize_fact(f):
    if any(a is None for a in f["participants"]): return None
    actors = {(a["id"],a["role"]):a for a in f["participants"] if a}
    f["participants"] = sorted(actors.values(),key=lambda a:(a["id"],a["role"]))
    if len({a["id"] for a in f["participants"]})<2 or not f["title"].strip():
        return None
    # Keep a compact, defensible event, not a giant compilation clique.
    if f["kind"]=="recording":
        if len(f["participants"])>16 or not any(a["role"] in ("performer","featured") for a in f["participants"]):
            return None
    return f

def fingerprint(f):
    # Identical relationship, title and role set across remasters/releases. Do not
    # merge different titles or collapse independent cover/production evidence.
    data=[f["kind"],key(f["title"]),[(a["id"],a["role"]) for a in f["participants"]]]
    return hashlib.sha256(json.dumps(data,separators=(",",":")).encode()).digest()

def load(archive, db):
    db.executescript("CREATE TABLE IF NOT EXISTS loaded(name TEXT PRIMARY KEY, rows INTEGER);")
    complete={r[0] for r in db.execute("SELECT name FROM loaded")}
    if complete==set(TABLES): return
    with tarfile.open(archive,"r|bz2") as tar:
        for item in tar:
            name=pathlib.PurePosixPath(item.name).name
            if name not in TABLES or name in complete or not item.isfile(): continue
            schema,columns=TABLES[name]
            print("loading",name,flush=True)
            with db:
                db.execute(f"DROP TABLE IF EXISTS {name}")
                db.execute(f"CREATE TABLE {name}({schema})")
                q=f"INSERT INTO {name} VALUES({','.join('?' for _ in columns)})"
                batch=[]; n=0
                for raw in tar.extractfile(item):
                    parts=raw.decode("utf-8").rstrip("\n").split("\t")
                    if len(parts)<=max(columns): raise ValueError(f"{name}: short row {n+1}")
                    batch.append(tuple(decode(parts[i]) for i in columns)); n+=1
                    if len(batch)>=20000: db.executemany(q,batch);batch.clear()
                if batch: db.executemany(q,batch)
                db.execute("INSERT INTO loaded VALUES(?,?)",(name,n))
            print("loaded",name,n,flush=True)
    missing=set(TABLES)-{r[0] for r in db.execute("SELECT name FROM loaded")}
    if missing: raise ValueError(f"missing dump tables: {missing}")

def prepare(db):
    # Exact source link types only. Unknown types are not promoted to connections.
    db.executescript("""
    CREATE INDEX IF NOT EXISTS ac_credit ON artist_credit_name(credit,pos);
    CREATE INDEX IF NOT EXISTS rec_credit ON recording(credit);
    CREATE INDEX IF NOT EXISTS ar_recording ON l_artist_recording(recording);
    CREATE INDEX IF NOT EXISTS ar_link ON l_artist_recording(link);
    CREATE TABLE IF NOT EXISTS wanted(id INTEGER PRIMARY KEY);
    """)
    types=list(db.execute("SELECT id,name,phrase FROM link_type WHERE entity0='artist' AND entity1='recording' ORDER BY id"))
    role_types={}
    for i,name,phrase in types:
        if name in {"producer","co-producer","executive producer"}: role_types[i]="producer"
        elif name in {"instrument","vocal","performer","conductor","orchestra","arranger"}: role_types[i]="performer"
    if not role_types: raise ValueError("no recording relationship types recognized")
    print("recording relationship types",role_types,flush=True)
    with db:
        db.execute("DROP TABLE IF EXISTS role_type")
        db.execute("CREATE TABLE role_type(id INTEGER PRIMARY KEY,role TEXT)")
        db.executemany("INSERT INTO role_type VALUES(?,?)",role_types.items())
        db.execute("DELETE FROM wanted")
        db.execute("""INSERT OR IGNORE INTO wanted
          SELECT r.id FROM recording r JOIN
          (SELECT credit FROM artist_credit_name GROUP BY credit HAVING count(DISTINCT artist)>1) c ON r.credit=c.credit""")
        db.execute("""INSERT OR IGNORE INTO wanted
          SELECT ar.recording FROM l_artist_recording ar JOIN link l ON l.id=ar.link JOIN role_type t ON t.id=l.type""")
    print("candidate recordings",db.execute("SELECT count(*) FROM wanted").fetchone()[0],flush=True)

def recording_facts(db):
    # Stream sorted rows; use source artist-credit position and join phrase for featured artists.
    q="""SELECT r.id,r.gid,r.title,a.gid,a.name,c.pos,c.phrase,'credit'
      FROM wanted w JOIN recording r ON r.id=w.id JOIN artist_credit_name c ON c.credit=r.credit JOIN artist a ON a.id=c.artist
      UNION ALL
      SELECT r.id,r.gid,r.title,a.gid,a.name,999,'',t.role
      FROM l_artist_recording ar JOIN link l ON l.id=ar.link JOIN role_type t ON t.id=l.type
      JOIN recording r ON r.id=ar.recording JOIN artist a ON a.id=ar.artist
      ORDER BY 1,6,4,8"""
    for _, rows in itertools.groupby(db.execute(q),key=lambda r:r[0]):
        participants=[]; prior=""; primary=set(); roles=[]
        for rid,gid,title,aid,name,pos,phrase,role in rows:
            if role=="credit":
                a=actor(aid,name,"featured" if FEATURE.search(prior) else "performer")
                prior=phrase or ""
                if a: participants.append(a);primary.add(aid)
                else: participants.append(None)
            else: roles.append((aid,name,role))
        for aid,name,role in roles:
            if role=="performer" and aid in primary: continue
            a=actor(aid,name,role)
            if a: participants.append(a)
        f=normalize_fact({"id":"mb:recording:"+gid,"kind":"recording","title":title,"source":"https://musicbrainz.org/recording/"+gid,"participants":participants})
        if f: yield f

def membership_facts(db):
    rows=db.execute("""SELECT a.gid,a.name,b.gid,b.name,t.name,t.phrase
        FROM l_artist_artist r JOIN link l ON l.id=r.link JOIN link_type t ON t.id=l.type
        JOIN artist a ON a.id=r.a JOIN artist b ON b.id=r.b
        WHERE t.entity0='artist' AND t.entity1='artist' AND t.name='member of band'""")
    for a,an,b,bn,name,phrase in rows:
        # MB link type is directed from member (entity0) to band (entity1).
        if not phrase or "member" not in phrase.lower(): continue
        f=normalize_fact({"id":f"mb:member:{a}:{b}","kind":"membership","title":bn+" membership",
              "source":"https://musicbrainz.org/artist/"+b+"/relationships",
              "participants":[actor(a,an,"member"),actor(b,bn,"group")]})
        if f: yield f

def credit_actors(db, credit, role):
    return [a for gid,name in db.execute("""SELECT a.gid,a.name FROM artist_credit_name c
        JOIN artist a ON a.id=c.artist WHERE c.credit=? ORDER BY c.pos""",(credit,))
        if (a:=actor(gid,name,role))]

def album_cover_facts(db):
    rows=db.execute("""SELECT a.gid,a.title,a.credit,b.gid,b.credit
        FROM l_release_group_release_group r JOIN link l ON l.id=r.link
        JOIN link_type t ON t.id=l.type
        JOIN release_group a ON a.id=r.a JOIN release_group b ON b.id=r.b
        WHERE t.entity0='release_group' AND t.entity1='release_group' AND t.name='cover'""")
    for gid,title,credit,original,ocredit in rows:
        p=credit_actors(db,credit,"performer")
        q=credit_actors(db,ocredit,"original")
        if not p or not q or {a["id"] for a in p}&{a["id"] for a in q}: continue
        f=normalize_fact({"id":f"mb:album-cover:{gid}:{original}","kind":"cover","title":title,
          "source":"https://musicbrainz.org/release-group/"+gid+"/relationships","participants":p+q})
        if f: yield f

def work_cover_facts(db):
    # The source explicitly marks a recording as a cover; the reference is a
    # uniquely credited unflagged recording of that work, NOT a proven original.
    db.executescript("""
    CREATE INDEX IF NOT EXISTS rw_work ON l_recording_work(work);
    CREATE INDEX IF NOT EXISTS la_link ON link_attribute(link);
    CREATE TABLE IF NOT EXISTS cover_links(id INTEGER PRIMARY KEY);
    DELETE FROM cover_links;
    INSERT OR IGNORE INTO cover_links SELECT a.link FROM link_attribute a
      JOIN link_attribute_type t ON t.id=a.attribute WHERE t.gid='1e8536bd-6eda-3822-8e78-1c0f4d3d2113';
    CREATE TABLE IF NOT EXISTS reference_credit(work INTEGER PRIMARY KEY,credit INTEGER);
    DELETE FROM reference_credit;
    INSERT INTO reference_credit
      SELECT rw.work,min(r.credit) FROM l_recording_work rw
      JOIN link l ON l.id=rw.link JOIN link_type t ON t.id=l.type
      JOIN recording r ON r.id=rw.recording
      WHERE t.entity0='recording' AND t.entity1='work' AND t.name='performance'
      AND NOT EXISTS (SELECT 1 FROM link_attribute a WHERE a.link=rw.link)
      GROUP BY rw.work HAVING count(DISTINCT r.credit)=1;
    """)
    rows=db.execute("""SELECT DISTINCT w.gid,w.title,r.gid,r.credit,ref.credit
      FROM l_recording_work rw JOIN cover_links cl ON cl.id=rw.link
      JOIN link l ON l.id=rw.link JOIN link_type t ON t.id=l.type
      JOIN work w ON w.id=rw.work JOIN recording r ON r.id=rw.recording
      JOIN reference_credit ref ON ref.work=rw.work
      WHERE t.entity0='recording' AND t.entity1='work' AND t.name='performance' AND r.credit<>ref.credit""")
    for wid,title,rid,credit,ref in rows:
        p=credit_actors(db,credit,"performer")
        q=credit_actors(db,ref,"reference")
        if not p or not q or {a["id"] for a in p}&{a["id"] for a in q}: continue
        f=normalize_fact({"id":f"mb:cover-reference:{rid}:{wid}","kind":"cover-reference","title":title,
          "source":"https://musicbrainz.org/work/"+wid,"participants":p+q})
        if f: yield f

class Shards:
    def __init__(self,root,limit):
        self.root=root;self.limit=limit;self.counts=collections.Counter();self.handles={};self.files=[]
    def put(self,tier,f):
        n=self.counts[tier]
        if n%self.limit==0:
            if tier in self.handles: self.handles[tier].close()
            p=self.root/f"{tier}-{n//self.limit:04d}.jsonl.gz"
            self.files.append(p);self.handles[tier]=gzip.open(p,"wt",encoding="utf-8",compresslevel=3)
        self.handles[tier].write(json.dumps(f,ensure_ascii=False,separators=(",",":"))+"\n")
        self.counts[tier]+=1
    def close(self):
        for h in self.handles.values(): h.close()

def build(db,root,priority,seed,limit):
    p=json.loads(priority.read_text())
    pa={a.get("artist_mbid") for a in p["artists"]}
    pr={r.get("recording_mbid") for r in p["recordings"]}
    pr.update(r.get("recording_mbid") for a in p.get("artist_recordings",[]) for r in a["recordings"])
    db.execute("DROP TABLE IF EXISTS seen")
    db.execute("CREATE TABLE seen(hash BLOB PRIMARY KEY) WITHOUT ROWID")
    db.execute("DROP TABLE IF EXISTS seen_id")
    db.execute("CREATE TABLE seen_id(id TEXT PRIMARY KEY) WITHOUT ROWID")
    # Existing curated and explicit cover evidence is preserved in its own canonical shards.
    for path in sorted(seed.glob("*.jsonl")):
        for line in path.open():
            f=normalize_fact(json.loads(line))
            if f: db.execute("INSERT OR IGNORE INTO seen VALUES(?)",(fingerprint(f),))
    out=Shards(root,limit); skipped=0
    try:
        for f in itertools.chain(membership_facts(db),album_cover_facts(db),work_cover_facts(db),recording_facts(db)):
            h=fingerprint(f)
            if not db.execute("INSERT OR IGNORE INTO seen VALUES(?)",(h,)).rowcount: skipped+=1;continue
            if not db.execute("INSERT OR IGNORE INTO seen_id VALUES(?)",(f["id"],)).rowcount: skipped+=1;continue
            tier="priority" if f["id"].split(":")[-1] in pr or any(a["id"] in pa for a in f["participants"]) else "longtail"
            out.put(tier,f)
            n=sum(out.counts.values())
            if n%100000==0:
                db.commit();print("emitted",dict(out.counts),"duplicates",skipped,flush=True)
    finally: out.close()
    db.commit()
    manifest={"counts":dict(out.counts),"duplicates_skipped":skipped,"files":[]}
    for path in out.files:
        with path.open("rb") as src: digest=hashlib.file_digest(src,"sha256").hexdigest()
        manifest["files"].append({"name":path.name,"bytes":path.stat().st_size,"sha256":digest})
    (root/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps(manifest["counts"]), "duplicates",skipped,flush=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("archive",type=pathlib.Path);p.add_argument("stage",type=pathlib.Path);p.add_argument("output",type=pathlib.Path)
    p.add_argument("--priority",type=pathlib.Path,default=pathlib.Path("corpus/priority.json"))
    p.add_argument("--seed",type=pathlib.Path,default=pathlib.Path("corpus"))
    p.add_argument("--shard-size",type=int,default=250000)
    a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True)
    if any(a.output.glob("*.jsonl.gz")): raise ValueError("output must be fresh; use a new staging directory")
    db=sqlite3.connect(a.stage)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        db.execute("PRAGMA temp_store=FILE")
        db.execute("PRAGMA cache_size=-262144")
        load(a.archive,db);prepare(db);build(db,a.output,a.priority,a.seed,a.shard_size)
    finally: db.close()

if __name__=="__main__": main()
