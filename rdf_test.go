package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestDumpRDF(t *testing.T) {
	input := `{"id":"e93eda0f-9475-45c1-9194-29020d9b83e9","name":"ocarina","relations":[{"type":"related instrument","target-type":"instrument","direction":"forward","instrument":{"id":"5441c29d-3602-4898-b1a1-b77fa23b8e50"}}]}`
	var b bytes.Buffer
	if err := dumpRDF("instrument", strings.NewReader(input), &b); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{vocab + "Instrument", vocab + "target", "https://musicbrainz.org/instrument/5441c29d-3602-4898-b1a1-b77fa23b8e50", vocab + "direction"} {
		if !strings.Contains(b.String(), s) {
			t.Fatalf("missing %s", s)
		}
	}
	if err := dumpRDF("artist", strings.NewReader("{}"), &b); err == nil {
		t.Fatal("accepted missing ID")
	}
}
