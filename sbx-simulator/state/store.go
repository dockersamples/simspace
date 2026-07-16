// Package state implements the SBX Simulator's filesystem-backed runtime state.
//
// Because `sbx` runs as a fresh process on every command, runtime state must
// persist between invocations. The Store loads state.json (seeding it from the
// lab manifest's `state:` block on first run), exposes dot-path access for the
// engine, and persists on save. See docs/scenario-spec.md §2.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FileName is the state document written inside $SBX_SIM_HOME.
const FileName = "state.json"

// HistoryKey is the reserved dot-path holding the append-only list of raw
// command lines executed. The engine appends to it after every command.
const HistoryKey = "history"

// Store holds runtime state for a single lab and knows where to persist it.
type Store struct {
	path string
	data map[string]any
}

// Load opens the state store rooted at home ($SBX_SIM_HOME). If no state file
// exists yet, the store is seeded from seed (a deep copy) and is not written
// until Save is called. The seed is normalized through a JSON round-trip so
// value types match a reloaded store exactly (e.g. numbers become float64),
// keeping first-run and later-run behavior identical.
func Load(home string, seed map[string]any) (*Store, error) {
	path := filepath.Join(home, FileName)

	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		var data map[string]any
		if uerr := json.Unmarshal(raw, &data); uerr != nil {
			return nil, fmt.Errorf("parse state %s: %w", path, uerr)
		}
		if data == nil {
			data = map[string]any{}
		}
		return &Store{path: path, data: data}, nil
	case os.IsNotExist(err):
		data, nerr := normalize(seed)
		if nerr != nil {
			return nil, fmt.Errorf("seed state: %w", nerr)
		}
		return &Store{path: path, data: data}, nil
	default:
		return nil, fmt.Errorf("read state %s: %w", path, err)
	}
}

// normalize round-trips a value through JSON so its concrete Go types match
// what a reloaded store would produce. A nil seed yields an empty object.
func normalize(seed map[string]any) (map[string]any, error) {
	if seed == nil {
		return map[string]any{}, nil
	}
	raw, err := json.Marshal(seed)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

// Get resolves a dot-path (e.g. "sandbox.running"). ok is false if any segment
// along the path is missing or traverses through a non-object.
func (s *Store) Get(path string) (value any, ok bool) {
	segs := splitPath(path)
	if len(segs) == 0 {
		return nil, false
	}
	var cur any = s.data
	for _, seg := range segs {
		m, isMap := cur.(map[string]any)
		if !isMap {
			return nil, false
		}
		v, present := m[seg]
		if !present {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

// Set writes value at a dot-path, creating intermediate objects as needed. A
// non-object encountered mid-path is replaced by a fresh object, since setting
// a.b.c declares a and a.b to be objects.
func (s *Store) Set(path string, value any) {
	segs := splitPath(path)
	if len(segs) == 0 {
		return
	}
	m := s.data
	for _, seg := range segs[:len(segs)-1] {
		next, ok := m[seg].(map[string]any)
		if !ok {
			next = map[string]any{}
			m[seg] = next
		}
		m = next
	}
	m[segs[len(segs)-1]] = value
}

// Append pushes value onto the list at a dot-path, creating the list (and any
// intermediate objects) if absent. An existing non-list value at the path is
// replaced by a new single-element list.
func (s *Store) Append(path string, value any) {
	existing, ok := s.Get(path)
	if !ok {
		s.Set(path, []any{value})
		return
	}
	list, isList := existing.([]any)
	if !isList {
		s.Set(path, []any{value})
		return
	}
	s.Set(path, append(list, value))
}

// AppendHistory records a raw command line in the reserved history list.
func (s *Store) AppendHistory(commandLine string) {
	s.Append(HistoryKey, commandLine)
}

// Data returns the underlying state tree. Callers must not mutate it directly;
// it exists for templating and tests.
func (s *Store) Data() map[string]any { return s.data }

// Save persists the state as indented JSON, creating $SBX_SIM_HOME if needed.
func (s *Store) Save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(s.path, raw, 0o644); err != nil {
		return fmt.Errorf("write state %s: %w", s.path, err)
	}
	return nil
}

// splitPath splits a dot-path into non-empty segments. An empty or all-dots
// path yields no segments.
func splitPath(path string) []string {
	if path == "" {
		return nil
	}
	parts := strings.Split(path, ".")
	segs := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		segs = append(segs, p)
	}
	return segs
}
