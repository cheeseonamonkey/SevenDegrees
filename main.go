package main

import (
	"flag"
	"fmt"
	"os"
)

func run(args []string) error {
	flags := flag.NewFlagSet("degrees", flag.ContinueOnError)
	path := flags.String("db", "degrees.sqlite", "SQLite graph")
	strict := flags.Bool("strict", false, "exclude covers and tributes")
	max := flags.Int("max", 7, "maximum degrees")
	if e := flags.Parse(args); e != nil {
		return e
	}
	a := flags.Args()
	if len(a) == 0 {
		return fmt.Errorf("usage: degrees [flags] import FILE... | find ARTIST ARTIST | neighbors ARTIST | stats | fetch MBID [MBID...] | normalize")
	}
	if a[0] == "normalize" {
		return normalize(os.Stdin, os.Stdout)
	}
	if a[0] == "fetch" {
		if len(a) < 2 {
			return fmt.Errorf("fetch requires MusicBrainz artist IDs")
		}
		return fetch(a[1:], os.Stdout)
	}
	db, e := openGraph(*path)
	if e != nil {
		return e
	}
	defer db.Close()
	switch a[0] {
	case "import":
		if len(a) < 2 {
			return fmt.Errorf("import requires files")
		}
		for _, p := range a[1:] {
			n, e := loadFile(db, p)
			if e != nil {
				return e
			}
			fmt.Printf("%s: %d facts\n", p, n)
		}
	case "find":
		if len(a) != 3 || *max < 0 || *max > 7 {
			return fmt.Errorf("find requires two artists and max 0–7")
		}
		start, e := resolve(db, a[1])
		if e != nil {
			return e
		}
		end, e := resolve(db, a[2])
		if e != nil {
			return e
		}
		steps, ok, e := find(db, start, end, *max, *strict)
		if e != nil {
			return e
		}
		if !ok {
			return fmt.Errorf("no path within %d degrees in this corpus", *max)
		}
		fmt.Printf("%d degrees: %s\n", len(steps), label(db, start))
		for _, s := range steps {
			fmt.Printf("  → %s [%s: %s]\n    %s\n", label(db, s.To), s.Kind, s.Title, s.Source)
		}
	case "neighbors":
		if len(a) != 2 {
			return fmt.Errorf("neighbors requires one artist")
		}
		id, e := resolve(db, a[1])
		if e != nil {
			return e
		}
		edges, e := neighbors(db, id, *strict)
		if e != nil {
			return e
		}
		for _, s := range edges {
			fmt.Printf("%s [%s: %s] %s\n", label(db, s.To), s.Kind, s.Title, s.Source)
		}
	case "stats":
		for _, table := range []string{"artist", "fact", "participant"} {
			var n int
			if e = db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); e != nil {
				return e
			}
			fmt.Printf("%s: %d\n", table, n)
		}
	default:
		return fmt.Errorf("unknown command %q", a[0])
	}
	return nil
}
func main() {
	if e := run(os.Args[1:]); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
