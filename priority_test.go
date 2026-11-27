package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrioritySelection(t *testing.T) {
	a := "a74b1b7f-71a5-4011-9441-d0b5e4122711"
	b := "5441c29d-3602-4898-b1a1-b77fa23b8e50"
	p := filepath.Join(t.TempDir(), "priority.json")
	if err := os.WriteFile(p, []byte(`{"artists":[{"artist_mbid":"`+a+`"}],"recordings":[{"recording_mbid":"`+b+`"}],"artist_recordings":[{"recordings":[{"recording_mbid":"`+a+`"}]}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	ids, err := priorityIDs(p, "artist")
	if err != nil || len(ids) != 1 || !ids[a] {
		t.Fatal(ids, err)
	}
	input := `{"id":"` + a + `","name":"Radiohead"}` + "\n" + `{"id":"` + b + `","name":"David Bowie"}`
	var buf bytes.Buffer
	if err := dumpSelectedRDF("artist", strings.NewReader(input), &buf, ids); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "Radiohead") || strings.Contains(buf.String(), "David Bowie") {
		t.Fatal(buf.String())
	}
	ids, err = priorityIDs(p, "recording")
	if err != nil || len(ids) != 2 {
		t.Fatal(ids, err)
	}
	if err := dumpRDF("artist", strings.NewReader(input), &buf); err != nil || !strings.Contains(buf.String(), "David Bowie") {
		t.Fatal("full pass must remain unfiltered", err)
	}
}
