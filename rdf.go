package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"
)

const vocab = "https://github.com/cheeseonamonkey/SevenDegrees/blob/main/ontology/music.ttl#"
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
const labelIRI = "http://www.w3.org/2000/01/rdf-schema#label"
const provenance = "http://www.w3.org/ns/prov#wasDerivedFrom"

type triples struct {
	w   *bufio.Writer
	err error
}

func iri(s string) string     { return "<" + s + ">" }
func literal(s string) string { b, _ := json.Marshal(s); return string(b) }
func (t *triples) emit(s, p, o string) {
	if t.err == nil {
		_, t.err = fmt.Fprintf(t.w, "%s %s %s .\n", iri(s), iri(p), o)
	}
}
func (t *triples) text(s, p, o string) {
	if o != "" {
		t.emit(s, p, literal(o))
	}
}
func (t *triples) link(s, p, o string) { t.emit(s, p, iri(o)) }
func (t *triples) close() error {
	if t.err != nil {
		return t.err
	}
	return t.w.Flush()
}
func artistIRI(id string) string {
	if mbid.MatchString(id) {
		return entityIRI("artist", id)
	}
	return vocab + "artist/" + url.PathEscape(id)
}
func entityIRI(kind, id string) string { return "https://musicbrainz.org/" + kind + "/" + id }

var entityClasses = map[string]string{"artist": "Artist", "area": "Area", "event": "Event", "instrument": "Instrument", "label": "Label", "place": "Place", "recording": "Recording", "release": "Release", "release-group": "ReleaseGroup", "series": "Series", "work": "Work", "url": "ExternalResource"}

func streamJSON(in io.Reader, fn func([]byte) error) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 65536), 64<<20)
	for n := 1; scanner.Scan(); n++ {
		if len(scanner.Bytes()) == 0 {
			continue
		}
		if err := fn(scanner.Bytes()); err != nil {
			return fmt.Errorf("line %d: %w", n, err)
		}
	}
	return scanner.Err()
}
func factsRDF(in io.Reader, out io.Writer) error {
	t := triples{w: bufio.NewWriter(out)}
	err := streamJSON(in, func(b []byte) error {
		var f Fact
		if e := json.Unmarshal(b, &f); e != nil {
			return e
		}
		if e := valid(f); e != nil {
			return e
		}
		s := vocab + "fact/" + url.PathEscape(f.ID)
		t.link(s, rdfType, vocab+"Fact")
		t.text(s, labelIRI, f.Title)
		t.text(s, vocab+"kind", f.Kind)
		source, err := url.Parse(f.Source)
		if err != nil || source.Scheme != "https" || source.Host == "" {
			return fmt.Errorf("invalid source URL %q", f.Source)
		}
		t.link(s, provenance, source.String())
		if strings.HasPrefix(f.ID, "mb:recording:") {
			t.link(s, vocab+"describes", entityIRI("recording", strings.TrimPrefix(f.ID, "mb:recording:")))
		}
		for _, a := range f.Participants {
			target := artistIRI(a.ID)
			p := s + "/participant/" + url.PathEscape(a.ID) + "/" + url.PathEscape(a.Role)
			t.link(target, rdfType, vocab+"Artist")
			t.text(target, labelIRI, a.Name)
			t.link(s, vocab+"participation", p)
			t.link(p, rdfType, vocab+"Participation")
			t.link(p, vocab+"artist", target)
			t.text(p, vocab+"role", a.Role)
		}
		return t.err
	})
	if err != nil {
		return err
	}
	return t.close()
}

type dumpEntity struct {
	ID, Name, Title, Type, Disambiguation, Description string
	Aliases                                            []struct {
		Name   string
		Locale string
	}
	Credits   []mbCredit        `json:"artist-credit"`
	Relations []json.RawMessage `json:"relations"`
}
type dumpRelation struct {
	Type                  string
	TypeID                string `json:"type-id"`
	TargetType            string `json:"target-type"`
	Direction, Begin, End string
	Attributes            []string
}

func dumpRDF(kind string, in io.Reader, out io.Writer) error {
	return dumpSelectedRDF(kind, in, out, nil)
}

func dumpSelectedRDF(kind string, in io.Reader, out io.Writer, ids map[string]bool) error {
	class, ok := entityClasses[kind]
	if !ok {
		return fmt.Errorf("unknown entity type %q", kind)
	}
	t := triples{w: bufio.NewWriter(out)}
	err := streamJSON(in, func(b []byte) error {
		var e dumpEntity
		if err := json.Unmarshal(b, &e); err != nil {
			return err
		}
		if !mbid.MatchString(e.ID) {
			return fmt.Errorf("invalid entity ID %q", e.ID)
		}
		if ids != nil && !ids[e.ID] {
			return nil
		}
		s := entityIRI(kind, e.ID)
		t.link(s, rdfType, vocab+class)
		t.text(s, labelIRI, e.Name)
		t.text(s, labelIRI, e.Title)
		t.text(s, vocab+"sourceType", e.Type)
		t.text(s, vocab+"disambiguation", e.Disambiguation)
		t.text(s, vocab+"description", e.Description)
		t.link(s, provenance, "https://musicbrainz.org/doc/MusicBrainz_Database/Download")
		for _, a := range e.Aliases {
			t.text(s, "http://www.w3.org/2004/02/skos/core#altLabel", a.Name)
		}
		for i, c := range e.Credits {
			if !mbid.MatchString(c.Artist.ID) {
				continue
			}
			p := fmt.Sprintf("%s#credit-%d", s, i)
			t.link(s, vocab+"participation", p)
			t.link(p, rdfType, vocab+"Participation")
			t.link(p, vocab+"artist", artistIRI(c.Artist.ID))
			t.text(p, vocab+"joinPhrase", c.Joinphrase)
		}
		for _, raw := range e.Relations {
			var r dumpRelation
			if err := json.Unmarshal(raw, &r); err != nil {
				return err
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil {
				return err
			}
			var target struct{ ID, Name, Title, Resource string }
			if data := fields[r.TargetType]; len(data) > 0 {
				if err := json.Unmarshal(data, &target); err != nil {
					return err
				}
			}
			p := fmt.Sprintf("%s#relation-%x", s, sha256.Sum256(raw))
			t.link(s, vocab+"relation", p)
			t.link(p, rdfType, vocab+"SourceRelationship")
			t.text(p, vocab+"sourceType", r.Type)
			t.text(p, vocab+"sourceTypeID", r.TypeID)
			t.text(p, vocab+"direction", r.Direction)
			t.text(p, vocab+"begin", r.Begin)
			t.text(p, vocab+"end", r.End)
			for _, a := range r.Attributes {
				t.text(p, vocab+"attribute", a)
			}
			if _, known := entityClasses[r.TargetType]; known && mbid.MatchString(target.ID) {
				t.link(p, vocab+"target", entityIRI(r.TargetType, target.ID))
			}
			if target.Resource != "" {
				t.text(p, vocab+"externalURL", target.Resource)
			}
		}
		return t.err
	})
	if err != nil {
		return err
	}
	return t.close()
}
