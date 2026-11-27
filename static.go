package main

import (
	"database/sql"
	"encoding/json"
	"io"
)

type staticArtist struct {
	webArtist
	Aliases []string `json:"aliases"`
}
type staticGraph struct {
	Artists []staticArtist       `json:"artists"`
	Edges   map[string][]webStep `json:"edges"`
	Facts   int                  `json:"facts"`
}

// Export the same role-aware adjacency used by the CLI and HTTP server.
// Keep one edge per destination and strict-mode eligibility.
func exportStatic(db *sql.DB, out io.Writer) error {
	g := staticGraph{Edges: map[string][]webStep{}}
	rows, e := db.Query("SELECT a.id,a.name,b.name FROM artist a JOIN alias b ON a.id=b.artist ORDER BY a.id,b.name")
	if e != nil {
		return e
	}
	for rows.Next() {
		var id, name, alias string
		if e = rows.Scan(&id, &name, &alias); e != nil {
			rows.Close()
			return e
		}
		if len(g.Artists) == 0 || g.Artists[len(g.Artists)-1].ID != id {
			g.Artists = append(g.Artists, staticArtist{webArtist{id, name}, nil})
		}
		a := &g.Artists[len(g.Artists)-1]
		a.Aliases = append(a.Aliases, alias)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if e = db.QueryRow("SELECT count(*) FROM fact").Scan(&g.Facts); e != nil {
		return e
	}
	names := map[string]string{}
	for _, a := range g.Artists {
		names[a.ID] = a.Name
	}
	for _, a := range g.Artists {
		steps, e := neighbors(db, a.ID, false)
		if e != nil {
			return e
		}
		type edgeKey struct {
			to    string
			cover bool
		}
		seen := map[edgeKey]bool{}
		for _, s := range steps {
			k := edgeKey{s.To, s.Kind == "cover" || s.Kind == "cover-reference" || s.Kind == "tribute"}
			if seen[k] {
				continue
			}
			seen[k] = true
			g.Edges[a.ID] = append(g.Edges[a.ID], webStep{webArtist{s.To, names[s.To]}, s.Kind, s.Title, s.Source})
		}
	}
	return json.NewEncoder(out).Encode(g)
}
