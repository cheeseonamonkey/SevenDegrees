package main

import (
	"bufio"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type Artist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}
type Fact struct {
	ID           string   `json:"id"`
	Kind         string   `json:"kind"`
	Title        string   `json:"title"`
	Source       string   `json:"source"`
	Participants []Artist `json:"participants"`
}
type Step struct{ From, To, Kind, Title, Source string }

const schema = `
CREATE TABLE IF NOT EXISTS artist(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alias(artist TEXT REFERENCES artist(id), name TEXT COLLATE NOCASE NOT NULL, PRIMARY KEY(artist,name));
CREATE INDEX IF NOT EXISTS alias_name ON alias(name);
CREATE INDEX IF NOT EXISTS artist_name ON artist(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS fact(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participant(fact TEXT REFERENCES fact(id), artist TEXT REFERENCES artist(id), role TEXT NOT NULL, PRIMARY KEY(fact,artist,role));
CREATE INDEX IF NOT EXISTS participant_artist ON participant(artist,fact);
`

func openGraph(path string) (*sql.DB, error) {
	db, e := sql.Open("sqlite3", path)
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	if _, e = db.Exec("PRAGMA foreign_keys=ON;" + schema); e != nil {
		db.Close()
		return nil, e
	}
	return db, nil
}

func ingest(db *sql.DB, r io.Reader) (int, error) {
	tx, e := db.Begin()
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	putFact, e := tx.Prepare("INSERT INTO fact VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,source=excluded.source")
	if e != nil {
		return 0, e
	}
	defer putFact.Close()
	clearParticipants, e := tx.Prepare("DELETE FROM participant WHERE fact=?")
	if e != nil {
		return 0, e
	}
	defer clearParticipants.Close()
	putArtist, e := tx.Prepare("INSERT INTO artist VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
	if e != nil {
		return 0, e
	}
	defer putArtist.Close()
	putAlias, e := tx.Prepare("INSERT OR IGNORE INTO alias VALUES(?,?)")
	if e != nil {
		return 0, e
	}
	defer putAlias.Close()
	putParticipant, e := tx.Prepare("INSERT OR IGNORE INTO participant VALUES(?,?,?)")
	if e != nil {
		return 0, e
	}
	defer putParticipant.Close()
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 4096), 4<<20)
	n := 0
	for s.Scan() {
		if strings.TrimSpace(s.Text()) == "" {
			continue
		}
		var f Fact
		if e = json.Unmarshal(s.Bytes(), &f); e != nil {
			return 0, fmt.Errorf("line %d: %w", n+1, e)
		}
		if e = valid(f); e != nil {
			return 0, e
		}
		if _, e = putFact.Exec(f.ID, f.Kind, f.Title, f.Source); e != nil {
			return 0, e
		}
		if _, e = clearParticipants.Exec(f.ID); e != nil {
			return 0, e
		}
		for _, a := range f.Participants {
			if _, e = putArtist.Exec(a.ID, a.Name); e != nil {
				return 0, e
			}
			if _, e = putAlias.Exec(a.ID, a.Name); e != nil {
				return 0, e
			}
			if _, e = putParticipant.Exec(f.ID, a.ID, a.Role); e != nil {
				return 0, e
			}
		}
		n++
	}
	if e = s.Err(); e != nil {
		return 0, e
	}
	return n, tx.Commit()
}

func resolve(db *sql.DB, name string) (string, error) {
	rows, e := db.Query("SELECT id,name FROM artist WHERE id=? OR name=? COLLATE NOCASE OR id IN (SELECT artist FROM alias WHERE name=?) ORDER BY id", name, name, name)
	if e != nil {
		return "", e
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id, n string
		if e = rows.Scan(&id, &n); e != nil {
			return "", e
		}
		ids = append(ids, id)
	}
	if e = rows.Err(); e != nil {
		return "", e
	}
	if len(ids) != 1 {
		return "", fmt.Errorf("%q resolved to %d artists: %s", name, len(ids), strings.Join(ids, ", "))
	}
	return ids[0], nil
}

func neighbors(db *sql.DB, id string, strict bool) ([]Step, error) {
	rows, e := db.Query(`
 SELECT a.artist,b.artist,f.kind,f.title,f.source,a.role,b.role
 FROM participant a JOIN participant b ON a.fact=b.fact AND a.artist<>b.artist
 JOIN fact f ON f.id=a.fact
 WHERE a.artist=?
 ORDER BY b.artist, CASE f.kind WHEN 'recording' THEN 0 WHEN 'performance' THEN 1 ELSE 2 END,f.id,a.role,b.role`, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var out []Step
	for rows.Next() {
		var s Step
		var a, b string
		if e = rows.Scan(&s.From, &s.To, &s.Kind, &s.Title, &s.Source, &a, &b); e != nil {
			return nil, e
		}
		kind, ok := classify(s.Kind, a, b, strict)
		if !ok {
			continue
		}
		s.Kind = kind
		out = append(out, s)
	}
	return out, rows.Err()
}

// Search both ends by complete BFS layers, expanding the smaller frontier.
// Edges are symmetric for traversal, while the source fact retains roles.
func find(db *sql.DB, start, end string, limit int, strict bool) ([]Step, bool, error) {
	return shortest(start, end, limit, func(id string) ([]Step, error) { return neighbors(db, id, strict) })
}

type visit struct {
	step  Step
	depth int
}
type frontier struct {
	nodes []string
	seen  map[string]visit
	depth int
}

func newFrontier(id string) *frontier { return &frontier{[]string{id}, map[string]visit{id: {}}, 0} }
func shortest(start, end string, limit int, adj func(string) ([]Step, error)) ([]Step, bool, error) {
	if start == end {
		return nil, true, nil
	}
	left, right := newFrontier(start), newFrontier(end)
	for len(left.nodes) > 0 && len(right.nodes) > 0 && left.depth+right.depth < limit {
		a, b := left, right
		if len(a.nodes) > len(b.nodes) {
			a, b = b, a
		}
		var next []string
		best := ""
		distance := limit + 1
		for _, id := range a.nodes {
			edges, e := adj(id)
			if e != nil {
				return nil, false, e
			}
			for _, s := range edges {
				if _, ok := a.seen[s.To]; ok {
					continue
				}
				v := visit{s, a.depth + 1}
				a.seen[s.To] = v
				next = append(next, s.To)
				if other, ok := b.seen[s.To]; ok && v.depth+other.depth < distance {
					best = s.To
					distance = v.depth + other.depth
				}
			}
		}
		a.nodes = next
		a.depth++
		if best != "" {
			var path []Step
			for at := best; at != start; {
				s := left.seen[at].step
				path = append(path, s)
				at = s.From
			}
			for l, r := 0, len(path)-1; l < r; l, r = l+1, r-1 {
				path[l], path[r] = path[r], path[l]
			}
			for at := best; at != end; {
				s := right.seen[at].step
				s.From, s.To = s.To, s.From
				path = append(path, s)
				at = s.To
			}
			return path, true, nil
		}
	}
	return nil, false, nil
}

func label(db *sql.DB, id string) string {
	var name string
	if db.QueryRow("SELECT name FROM artist WHERE id=?", id).Scan(&name) != nil {
		return id
	}
	return name
}

func loadFile(db *sql.DB, path string) (int, error) {
	f, e := os.Open(path)
	if e != nil {
		return 0, e
	}
	defer f.Close()
	if strings.HasSuffix(path, ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return 0, err
		}
		defer gz.Close()
		return ingest(db, gz)
	}
	return ingest(db, f)
}
