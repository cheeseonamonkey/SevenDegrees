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

func valid(f Fact) error {
	if f.ID == "" || f.Title == "" || !strings.HasPrefix(f.Source, "https://") || len(f.Participants) < 2 {
		return fmt.Errorf("invalid fact %q", f.ID)
	}
	roles := map[string]int{}
	ids := map[string]bool{}
	for _, a := range f.Participants {
		if a.ID == "" || a.Name == "" || a.Role == "" {
			return fmt.Errorf("invalid participant in %s", f.ID)
		}
		roles[a.Role]++
		ids[a.ID] = true
	}
	if len(ids) < 2 {
		return fmt.Errorf("fact %s has fewer than two artists", f.ID)
	}
	switch f.Kind {
	case "recording", "performance":
		if roles["performer"]+roles["featured"] < 1 {
			return fmt.Errorf("missing performer: %s", f.ID)
		}
		for role := range roles {
			if role != "performer" && role != "featured" && role != "producer" {
				return fmt.Errorf("invalid role %s", role)
			}
		}
	case "cover-reference":
		if roles["performer"] == 0 || roles["reference"] == 0 || len(roles) != 2 {
			return fmt.Errorf("invalid cover-reference roles: %s", f.ID)
		}
	case "cover", "tribute":
		if roles["performer"] == 0 || roles["original"] == 0 || len(roles) != 2 {
			return fmt.Errorf("invalid cover/tribute roles: %s", f.ID)
		}
	case "membership":
		if roles["member"] == 0 || roles["group"] != 1 || len(roles) != 2 {
			return fmt.Errorf("invalid membership roles: %s", f.ID)
		}
	default:
		return fmt.Errorf("unknown kind %s", f.Kind)
	}
	return nil
}

func ingest(db *sql.DB, r io.Reader) (int, error) {
	tx, e := db.Begin()
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
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
		if _, e = tx.Exec("INSERT INTO fact VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,source=excluded.source", f.ID, f.Kind, f.Title, f.Source); e != nil {
			return 0, e
		}
		if _, e = tx.Exec("DELETE FROM participant WHERE fact=?", f.ID); e != nil {
			return 0, e
		}
		for _, a := range f.Participants {
			if _, e = tx.Exec("INSERT INTO artist VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", a.ID, a.Name); e != nil {
				return 0, e
			}
			if _, e = tx.Exec("INSERT OR IGNORE INTO alias VALUES(?,?)", a.ID, a.Name); e != nil {
				return 0, e
			}
			if _, e = tx.Exec("INSERT OR IGNORE INTO participant VALUES(?,?,?)", f.ID, a.ID, a.Role); e != nil {
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
 WHERE a.artist=? AND (
 (f.kind IN ('recording','performance') AND (a.role<>'producer' OR b.role<>'producer'))
 OR (f.kind IN ('cover','cover-reference','tribute','membership') AND a.role<>b.role))
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
		if strict && (s.Kind == "cover" || s.Kind == "cover-reference" || s.Kind == "tribute") {
			continue
		}
		if s.Kind == "recording" || s.Kind == "performance" {
			if a == "producer" || b == "producer" {
				s.Kind = "production"
			} else if a == "featured" || b == "featured" {
				s.Kind = "featured"
			}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// BFS visits each artist once, retaining an evidence-bearing predecessor.
func find(db *sql.DB, start, end string, limit int, strict bool) ([]Step, bool, error) {
	if start == end {
		return nil, true, nil
	}
	type node struct {
		id    string
		depth int
	}
	queue := []node{{start, 0}}
	prev := map[string]Step{start: {}}
	for i := 0; i < len(queue); i++ {
		n := queue[i]
		if n.depth >= limit {
			continue
		}
		edges, e := neighbors(db, n.id, strict)
		if e != nil {
			return nil, false, e
		}
		for _, s := range edges {
			if _, ok := prev[s.To]; ok {
				continue
			}
			prev[s.To] = s
			if s.To == end {
				var path []Step
				for at := end; at != start; {
					p := prev[at]
					path = append(path, p)
					at = p.From
				}
				for l, r := 0, len(path)-1; l < r; l, r = l+1, r-1 {
					path[l], path[r] = path[r], path[l]
				}
				return path, true, nil
			}
			queue = append(queue, node{s.To, n.depth + 1})
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
