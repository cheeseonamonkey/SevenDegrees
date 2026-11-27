package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type priorityEntry struct {
	Artist    string `json:"artist_mbid"`
	Recording string `json:"recording_mbid"`
}
type prioritySnapshot struct {
	Artists, Recordings []priorityEntry
	ArtistRecordings    []struct {
		Artist     string `json:"artist_mbid"`
		Recordings []priorityEntry
	} `json:"artist_recordings"`
}

// A priority pass selects an explicit subset; the unfiltered pass still owns full ingestion.
func priorityIDs(path, kind string) (map[string]bool, error) {
	if kind != "artist" && kind != "recording" {
		return nil, fmt.Errorf("priority selection supports artist and recording dumps")
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	var p prioritySnapshot
	if e = json.NewDecoder(f).Decode(&p); e != nil {
		return nil, e
	}
	ids := map[string]bool{}
	add := func(id string) {
		if mbid.MatchString(id) {
			ids[id] = true
		}
	}
	if kind == "artist" {
		for _, a := range p.Artists {
			add(a.Artist)
		}
	} else {
		for _, r := range p.Recordings {
			add(r.Recording)
		}
		for _, a := range p.ArtistRecordings {
			for _, r := range a.Recordings {
				add(r.Recording)
			}
		}
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("empty %s priority selection", kind)
	}
	return ids, nil
}
