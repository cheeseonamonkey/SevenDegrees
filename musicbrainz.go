package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

var mbid = regexp.MustCompile(`^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)

type mbCredit struct {
	Artist     struct{ ID, Name string }
	Joinphrase string
}
type mbRecording struct {
	ID, Title string
	Credits   []mbCredit `json:"artist-credit"`
}
type mbPage struct {
	Count      int
	Recordings []mbRecording
}

func recordingFact(r mbRecording) (Fact, bool) {
	f := Fact{ID: "mb:recording:" + r.ID, Kind: "recording", Title: r.Title, Source: "https://musicbrainz.org/recording/" + r.ID}
	seen := map[string]bool{}
	for i, c := range r.Credits {
		if c.Artist.ID == "" || seen[c.Artist.ID] {
			continue
		}
		// MusicBrainz stores the separator on the preceding credit.
		role := "performer"
		if i > 0 && featured(r.Credits[i-1].Joinphrase) {
			role = "featured"
		}
		if i > 0 && r.Credits[i-1].Joinphrase == "" {
			role = "performer"
		}
		if c.Artist.ID == "89ad4ac3-39f7-470e-963a-56509c546377" {
			return Fact{}, false
		} // Various Artists
		f.Participants = append(f.Participants, Artist{ID: c.Artist.ID, Name: c.Artist.Name, Role: role})
		seen[c.Artist.ID] = true
	}
	return f, len(f.Participants) >= 2 && len(f.Participants) <= 12
}
func featured(s string) bool { return featurePattern.MatchString(s) }

var featurePattern = regexp.MustCompile(`(?i)\b(feat\.?|featuring|ft\.?)\b`)

// normalize reads an archived MusicBrainz recording search response.
func normalize(in io.Reader, out io.Writer) error {
	var page mbPage
	if err := json.NewDecoder(in).Decode(&page); err != nil {
		return err
	}
	if page.Recordings == nil {
		return fmt.Errorf("missing recordings")
	}
	enc := json.NewEncoder(out)
	seen := map[string]bool{}
	for _, r := range page.Recordings {
		if seen[r.ID] || !mbid.MatchString(r.ID) {
			continue
		}
		if f, ok := recordingFact(r); ok {
			if err := valid(f); err != nil {
				return err
			}
			if err := enc.Encode(f); err != nil {
				return err
			}
			seen[r.ID] = true
		}
	}
	return nil
}

func fetch(ids []string, out io.Writer) error {
	client := &http.Client{Timeout: 20 * time.Second}
	enc := json.NewEncoder(out)
	seen := map[string]bool{}
	for _, id := range ids {
		if !mbid.MatchString(id) {
			return fmt.Errorf("invalid MBID %q", id)
		}
		for offset := 0; ; offset += 100 {
			q := url.Values{"query": {"arid:" + id}, "fmt": {"json"}, "limit": {"100"}, "offset": {fmt.Sprint(offset)}}
			req, e := http.NewRequest("GET", "https://musicbrainz.org/ws/2/recording?"+q.Encode(), nil)
			if e != nil {
				return e
			}
			req.Header.Set("User-Agent", "SevenDegrees/0.1 (https://github.com/cheeseonamonkey/SevenDegrees)")
			resp, e := client.Do(req)
			if e != nil {
				return e
			}
			if resp.StatusCode != 200 {
				resp.Body.Close()
				return fmt.Errorf("MusicBrainz: %s", resp.Status)
			}
			var page mbPage
			e = json.NewDecoder(resp.Body).Decode(&page)
			resp.Body.Close()
			if e != nil {
				return e
			}
			for _, r := range page.Recordings {
				match := false
				for _, c := range r.Credits {
					if c.Artist.ID == id {
						match = true
						break
					}
				}
				if !match || seen[r.ID] {
					continue
				}
				if f, ok := recordingFact(r); ok {
					if e = enc.Encode(f); e != nil {
						return e
					}
					seen[r.ID] = true
				}
			}
			time.Sleep(1100 * time.Millisecond)
			if offset+len(page.Recordings) >= page.Count || len(page.Recordings) == 0 {
				break
			}
		}
	}
	return nil
}
