package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"sort"
)

type staticArtist struct {
	webArtist
	Aliases []string `json:"aliases,omitempty"`
}

// Each directed adjacency entry consists of two integers: destination and
// evidence index. Evidence and strings are shared, rather than copied per edge.
type staticGraph struct {
	Version   int            `json:"version"`
	Artists   []staticArtist `json:"artists"`
	Strings   []string       `json:"strings"`
	Evidence  [][4]int       `json:"evidence"` // kind, title, source, relationship category bit
	Offsets   []int          `json:"offsets"`
	Adjacency []int          `json:"adjacency"`
	Facts     int            `json:"facts"`
}

type dictionary[T comparable] struct {
	values []T
	index  map[T]int
}

func (d *dictionary[T]) intern(v T) int {
	if d.index == nil {
		d.index = map[T]int{}
	}
	if i, ok := d.index[v]; ok {
		return i
	}
	i := len(d.values)
	d.index[v] = i
	d.values = append(d.values, v)
	return i
}

func exportStatic(db *sql.DB, out io.Writer) error {
	g := staticGraph{Version: 3, Offsets: []int{0}}
	rows, e := db.Query("SELECT a.id,a.name,b.name FROM artist a LEFT JOIN alias b ON a.id=b.artist ORDER BY a.id,b.name")
	if e != nil {
		return e
	}
	ids := map[string]int{}
	for rows.Next() {
		var id, name string
		var alias sql.NullString
		if e = rows.Scan(&id, &name, &alias); e != nil {
			rows.Close()
			return e
		}
		i, ok := ids[id]
		if !ok {
			i = len(g.Artists)
			ids[id] = i
			g.Artists = append(g.Artists, staticArtist{webArtist{id, name}, nil})
		}
		if alias.Valid && alias.String != name {
			g.Artists[i].Aliases = append(g.Artists[i].Aliases, alias.String)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if e = db.QueryRow("SELECT count(*) FROM fact").Scan(&g.Facts); e != nil {
		return e
	}
	// Scan each fact once, rather than seeking the same recording for every
	// artist. An edge keeps the best evidence for each policy class.
	type witness struct {
		kind, title, source, id string
		rank                    int
	}
	type target struct{ to, category int }
	edges := make([]map[target]*witness, len(g.Artists))
	add := func(from, to int, w *witness) {
		k := target{to, categoryBits[w.kind]}
		if edges[from] == nil {
			edges[from] = make(map[target]*witness)
		}
		old := edges[from][k]
		if old == nil || w.rank < old.rank || (w.rank == old.rank && w.id < old.id) {
			edges[from][k] = w
		}
	}
	rows, e = db.Query("SELECT f.id,f.kind,f.title,f.source,p.artist,p.role FROM fact f JOIN participant p ON p.fact=f.id ORDER BY f.id,p.artist,p.role")
	if e != nil {
		return e
	}
	type credit struct {
		artist int
		role   string
	}
	var group []credit
	var id, kind, title, source string
	flush := func() {
		rank := 2
		if kind == "recording" {
			rank = 0
		} else if kind == "performance" {
			rank = 1
		}
		witnesses := map[string]*witness{}
		for i, a := range group {
			for _, b := range group[i+1:] {
				if a.artist == b.artist {
					continue
				}
				k, ok := classify(kind, a.role, b.role, false)
				if !ok {
					continue
				}
				w := witnesses[k]
				if w == nil {
					w = &witness{k, title, source, id, rank}
					witnesses[k] = w
				}
				add(a.artist, b.artist, w)
				add(b.artist, a.artist, w)
			}
		}
	}
	for rows.Next() {
		var fid, fkind, ftitle, fsrc, artist, role string
		if e = rows.Scan(&fid, &fkind, &ftitle, &fsrc, &artist, &role); e != nil {
			rows.Close()
			return e
		}
		if fid != id {
			flush()
			group = group[:0]
			id, kind, title, source = fid, fkind, ftitle, fsrc
		}
		i, ok := ids[artist]
		if ok {
			group = append(group, credit{i, role})
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	flush()
	var strings dictionary[string]
	var evidence dictionary[[4]int]
	for _, adj := range edges {
		keys := make([]target, 0, len(adj))
		for k := range adj {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			a, b := keys[i], keys[j]
			if a.to != b.to {
				return a.to < b.to
			}
			return a.category < b.category
		})
		for _, k := range keys {
			w := adj[k]
			index := evidence.intern([4]int{strings.intern(w.kind), strings.intern(w.title), strings.intern(w.source), k.category})
			g.Adjacency = append(g.Adjacency, k.to, index)
		}
		g.Offsets = append(g.Offsets, len(g.Adjacency))
	}
	g.Strings = strings.values
	g.Evidence = evidence.values
	return json.NewEncoder(out).Encode(g)
}
