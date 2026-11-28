package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWeb(t *testing.T) {
	db, e := openGraph(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = loadFile(db, "corpus/curated.jsonl"); e != nil {
		t.Fatal(e)
	}
	h := webAPI(db)
	request := func(path string, status int) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != status {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		return w
	}
	request("/", 200)
	request("/app.js", 200)
	w := request("/api/artists?q=morello", 200)
	var artists []webArtist
	if e = json.Unmarshal(w.Body.Bytes(), &artists); e != nil || len(artists) != 1 {
		t.Fatal(w.Body.String(), e)
	}
	for _, strict := range []bool{false, true} {
		suffix := ""
		if strict {
			suffix = "&strict=true"
		}
		w = request("/api/path?from=Tom+Morello&to=David+Bowie"+suffix, 200)
		var p struct {
			Found   bool
			Degrees int
			Steps   []webStep
		}
		if e = json.Unmarshal(w.Body.Bytes(), &p); e != nil || p.Found == strict || (!strict && (p.Degrees != 3 || p.Steps[2].Kind != "tribute")) {
			t.Fatal(w.Body.String(), e)
		}
	}
	request("/api/path?from=missing&to=David+Bowie", 400)
	request("/api/stats", 200)
	request("/api/categories", 200)
	request("/api/neighbors?artist=Tom+Morello&covers=maybe", 400)
	w = request("/api/path?from=Tom+Morello&to=David+Bowie&covers=false", 200)
	var filtered struct{ Found bool }
	if e = json.Unmarshal(w.Body.Bytes(), &filtered); e != nil || filtered.Found {
		t.Fatal(w.Body.String(), e)
	}
}
