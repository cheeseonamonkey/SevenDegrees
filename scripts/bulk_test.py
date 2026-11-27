import io
import json
import pathlib
import sqlite3
import tarfile
import tempfile
import unittest
import bulk_relationships as b

def uid(n): return f"00000000-0000-0000-0000-{n:012d}"
def fixture(path):
    rows={
      "artist":[[1,uid(1),"A"],[2,uid(2),"B"],[3,uid(3),"C"],[4,uid(4),"D"]],
      "artist_credit_name":[[1,0,1,"", " feat. "],[1,1,2,"",""],[2,0,1,"",""],[3,0,3,"",""],[4,0,4,"",""]],
      "recording":[[1,uid(11),"Together",1],[2,uid(12),"Solo",2],[3,uid(13),"Cover",3],[4,uid(14),"Original",4],[5,uid(15),"Produced",2],[6,uid(16),"Together",1]],
      "link_type":[[1,"",0,uid(101),"artist","recording","producer","","producer"],[2,"",0,uid(102),"artist","artist","member of band","","member of"],[3,"",0,uid(103),"release_group","release_group","cover","","cover of"],[4,"",0,uid(104),"recording","work","performance","","recording of"]],
      "link":[[1,1],[2,2],[3,3],[4,4],[5,4]],
      "l_artist_recording":[[1,1,3,5]],
      "l_artist_artist":[[1,2,1,4]],
      "release_group":[[1,uid(21),"Album cover",3],[2,uid(22),"Original album",4]],
      "l_release_group_release_group":[[1,3,1,2]],
      "work":[[1,uid(31),"Shared work"]],
      "l_recording_work":[[1,4,3,1],[2,5,4,1]],
      "link_attribute":[[4,1]],
      "link_attribute_type":[[1,"",1,0,"1e8536bd-6eda-3822-8e78-1c0f4d3d2113","cover"]]
    }
    with tarfile.open(path,"w:bz2") as t:
        for name,values in rows.items():
            data="".join("\t".join(map(str,row))+"\n" for row in values).encode()
            info=tarfile.TarInfo("mbdump/"+name);info.size=len(data);t.addfile(info,io.BytesIO(data))

class BulkTest(unittest.TestCase):
    def test_pipeline(self):
        with tempfile.TemporaryDirectory() as root:
            p=pathlib.Path(root); archive=p/"dump.tar.bz2";fixture(archive)
            db=sqlite3.connect(p/"stage.sqlite")
            b.load(archive,db);b.load(archive,db);b.prepare(db)
            seed=p/"seed";seed.mkdir();out=p/"out";out.mkdir()
            priority=p/"priority.json";priority.write_text(json.dumps({"artists":[{"artist_mbid":uid(1)}],"recordings":[]}))
            b.build(db,out,priority,seed,2)
            import gzip
            facts=[json.loads(l) for f in out.glob("*.gz") for l in gzip.open(f,"rt")]
            self.assertEqual(len(facts),5)
            self.assertEqual({f["kind"] for f in facts},{"recording","membership","cover","cover-reference"})
            self.assertEqual(sum(f["title"]=="Together" for f in facts),1)
            self.assertTrue(any(a["role"]=="featured" for f in facts for a in f["participants"]))
            self.assertTrue(any(a["role"]=="producer" for f in facts for a in f["participants"]))
            self.assertEqual(json.loads((out/"manifest.json").read_text())["duplicates_skipped"],1)
            db.close()
    def test_copy(self):
        self.assertEqual(b.decode(r"a\tb\\c"),"a\tb\\c")
        self.assertIsNone(b.decode(r"\N"))
if __name__=="__main__": unittest.main()
