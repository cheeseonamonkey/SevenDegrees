package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

//go:embed web/*
var webAssets embed.FS

type webArtist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type webStep struct {
	To     webArtist `json:"to"`
	Kind   string    `json:"kind"`
	Title  string    `json:"title"`
	Source string    `json:"source"`
}

func webAPI(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	jsonReply := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	fail := func(w http.ResponseWriter, status int, e error) {
		jsonReply(w, status, map[string]string{"error": e.Error()})
	}
	mux.HandleFunc("GET /api/artists", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) > 200 {
			fail(w, 400, fmt.Errorf("query too long"))
			return
		}
		rows, e := db.QueryContext(r.Context(), `SELECT DISTINCT a.id,a.name FROM artist a JOIN alias b ON b.artist=a.id WHERE instr(lower(b.name),lower(?))>0 ORDER BY CASE WHEN a.name=? COLLATE NOCASE THEN 0 ELSE 1 END,length(a.name),a.name,a.id LIMIT 20`, q, q)
		if e != nil {
			fail(w, 500, fmt.Errorf("search unavailable"))
			return
		}
		defer rows.Close()
		result := []webArtist{}
		for rows.Next() {
			var a webArtist
			if e = rows.Scan(&a.ID, &a.Name); e != nil {
				fail(w, 500, fmt.Errorf("search unavailable"))
				return
			}
			result = append(result, a)
		}
		if rows.Err() != nil {
			fail(w, 500, fmt.Errorf("search unavailable"))
			return
		}
		jsonReply(w, 200, result)
	})
	mux.HandleFunc("GET /api/path", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		a, e := resolve(db, q.Get("from"))
		if e != nil {
			fail(w, 400, e)
			return
		}
		b, e := resolve(db, q.Get("to"))
		if e != nil {
			fail(w, 400, e)
			return
		}
		steps, ok, e := find(db, a, b, 7, q.Get("strict") == "true")
		if e != nil {
			fail(w, 500, fmt.Errorf("search unavailable"))
			return
		}
		result := []webStep{}
		for _, s := range steps {
			result = append(result, webStep{webArtist{s.To, label(db, s.To)}, s.Kind, s.Title, s.Source})
		}
		jsonReply(w, 200, map[string]any{"found": ok, "start": webArtist{a, label(db, a)}, "steps": result, "degrees": len(result)})
	})
	mux.HandleFunc("GET /api/stats", func(w http.ResponseWriter, r *http.Request) {
		result := map[string]int{}
		for _, table := range []string{"artist", "fact", "participant"} {
			var n int
			if db.QueryRowContext(r.Context(), "SELECT count(*) FROM "+table).Scan(&n) != nil {
				fail(w, 500, fmt.Errorf("stats unavailable"))
				return
			}
			result[table] = n
		}
		jsonReply(w, 200, result)
	})
	assets, _ := fs.Sub(webAssets, "web")
	mux.Handle("GET /", http.FileServer(http.FS(assets)))
	return mux
}
func serve(db *sql.DB, addr string) error {
	srv := &http.Server{Addr: addr, Handler: webAPI(db), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	fmt.Println("SevenDegrees: http://" + addr)
	return srv.ListenAndServe()
}
