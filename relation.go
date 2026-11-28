package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
)

//go:embed ontology/relations.json
var rulesJSON []byte

type relationRule struct {
	Class    string
	Roles    []string
	Required [][]string
	Single   []string
	Strict   bool
	Mode     string
}

var rules = func() map[string]relationRule {
	var m map[string]relationRule
	if e := json.Unmarshal(rulesJSON, &m); e != nil {
		panic(e)
	}
	return m
}()

func valid(f Fact) error {
	u, e := url.Parse(f.Source)
	if f.ID == "" || strings.TrimSpace(f.Title) == "" || e != nil || u.Scheme != "https" || u.Host == "" || len(f.Participants) < 2 {
		return fmt.Errorf("invalid fact %q", f.ID)
	}
	r, ok := rules[f.Kind]
	if !ok {
		return fmt.Errorf("unknown kind %s", f.Kind)
	}
	roles := map[string]int{}
	ids := map[string]bool{}
	for _, a := range f.Participants {
		if a.ID == "" || strings.TrimSpace(a.Name) == "" || !slices.Contains(r.Roles, a.Role) {
			return fmt.Errorf("invalid participant in %s", f.ID)
		}
		roles[a.Role]++
		ids[a.ID] = true
	}
	if len(ids) < 2 {
		return fmt.Errorf("fact %s has fewer than two artists", f.ID)
	}
	for _, group := range r.Required {
		found := false
		for _, role := range group {
			found = found || roles[role] > 0
		}
		if !found {
			return fmt.Errorf("missing required role %v in %s", group, f.ID)
		}
	}
	for _, role := range r.Single {
		if roles[role] != 1 {
			return fmt.Errorf("expected one %s in %s", role, f.ID)
		}
	}
	return nil
}

func classify(kind, a, b string, strict bool) (string, bool) {
	r, ok := rules[kind]
	if !ok || (strict && !r.Strict) || !slices.Contains(r.Roles, a) || !slices.Contains(r.Roles, b) {
		return "", false
	}
	if r.Mode == "cross" {
		return kind, a != b
	}
	if a == "producer" && b == "producer" {
		return "", false
	}
	if a == "producer" || b == "producer" {
		return "production", true
	}
	if a == "featured" || b == "featured" {
		return "featured", true
	}
	return kind, true
}

func strictEdge(kind string) bool {
	if kind == "production" || kind == "featured" {
		return true
	}
	return rules[kind].Strict
}

//go:embed ontology/categories.json
var categoryJSON []byte
var categoryBits = func() map[string]int {
	var categories map[string]struct {
		Bit   int
		Kinds []string
	}
	if err := json.Unmarshal(categoryJSON, &categories); err != nil {
		panic(err)
	}
	result := map[string]int{}
	for _, c := range categories {
		for _, k := range c.Kinds {
			result[k] = c.Bit
		}
	}
	return result
}()
