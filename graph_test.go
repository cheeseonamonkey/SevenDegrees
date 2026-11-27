package main

import (
	"strings"
	"testing"
)

func TestOriginalChain(t *testing.T) {
	db, e := openGraph(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	for i := 0; i < 2; i++ {
		if n, e := loadFile(db, "corpus/curated.jsonl"); e != nil || n != 4 {
			t.Fatalf("import: %d %v", n, e)
		}
	}
	var n int
	db.QueryRow("SELECT count(*) FROM fact").Scan(&n)
	if n != 4 {
		t.Fatal(n)
	}
	a, e := resolve(db, "Tom Morello")
	if e != nil {
		t.Fatal(e)
	}
	b, e := resolve(db, "David Bowie")
	if e != nil {
		t.Fatal(e)
	}
	for _, tt := range []struct {
		max        int
		strict, ok bool
	}{{7, false, true}, {2, false, false}, {7, true, false}} {
		p, ok, e := find(db, a, b, tt.max, tt.strict)
		if e != nil || ok != tt.ok {
			t.Fatalf("%+v: %v %v", tt, p, e)
		}
		if ok && (len(p) != 3 || p[2].Kind != "tribute") {
			t.Fatal(p)
		}
	}
	p, ok, e := find(db, b, a, 7, false)
	if e != nil || !ok || len(p) != 3 {
		t.Fatalf("reverse: %v %v", p, e)
	}
	if _, e = ingest(db, strings.NewReader("bad")); e == nil {
		t.Fatal("accepted invalid corpus")
	}
}

func TestFeatureJoinPhrase(t *testing.T) {
	for _, s := range []string{" feat. ", " featuring ", " ft. "} {
		if !featured(s) {
			t.Fatal(s)
		}
	}
	if featured(" with ") {
		t.Fatal("with is not explicit featuring")
	}
}
