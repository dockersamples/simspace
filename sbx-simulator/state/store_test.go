package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSeedsWhenNoFile(t *testing.T) {
	home := t.TempDir()
	seed := map[string]any{
		"sandbox": map[string]any{"running": false},
		"phase":   "start",
	}
	s, err := Load(home, seed)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if v, ok := s.Get("sandbox.running"); !ok || v != false {
		t.Fatalf("sandbox.running = %v, %v; want false, true", v, ok)
	}
	if v, ok := s.Get("phase"); !ok || v != "start" {
		t.Fatalf("phase = %v, %v; want start, true", v, ok)
	}

	// Seeding must not write until Save.
	if _, err := os.Stat(filepath.Join(home, FileName)); !os.IsNotExist(err) {
		t.Fatalf("state file should not exist before Save; stat err = %v", err)
	}
}

func TestSavePersistsAndReloads(t *testing.T) {
	home := t.TempDir()
	s, err := Load(home, map[string]any{"sandbox": map[string]any{"running": false}})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	s.Set("sandbox.running", true)
	s.Set("phase", "running")
	if err := s.Save(); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Reload; the seed is ignored because the file now exists.
	s2, err := Load(home, map[string]any{"sandbox": map[string]any{"running": false}})
	if err != nil {
		t.Fatalf("reload Load: %v", err)
	}
	if v, ok := s2.Get("sandbox.running"); !ok || v != true {
		t.Fatalf("reloaded sandbox.running = %v, %v; want true, true", v, ok)
	}
	if v, ok := s2.Get("phase"); !ok || v != "running" {
		t.Fatalf("reloaded phase = %v, %v; want running, true", v, ok)
	}
}

func TestSetCreatesIntermediateObjects(t *testing.T) {
	s := &Store{data: map[string]any{}}
	s.Set("a.b.c", "deep")
	if v, ok := s.Get("a.b.c"); !ok || v != "deep" {
		t.Fatalf("a.b.c = %v, %v; want deep, true", v, ok)
	}
}

func TestSetReplacesNonObjectIntermediate(t *testing.T) {
	s := &Store{data: map[string]any{"a": "scalar"}}
	s.Set("a.b", 1)
	if v, ok := s.Get("a.b"); !ok || v != 1 {
		t.Fatalf("a.b = %v, %v; want 1, true", v, ok)
	}
}

func TestGetMissingAndThroughScalar(t *testing.T) {
	s := &Store{data: map[string]any{"a": "scalar"}}
	if _, ok := s.Get("missing"); ok {
		t.Fatal("missing key should not be ok")
	}
	if _, ok := s.Get("a.b.c"); ok {
		t.Fatal("traversing through scalar should not be ok")
	}
	if _, ok := s.Get(""); ok {
		t.Fatal("empty path should not be ok")
	}
}

func TestAppendCreatesAndExtends(t *testing.T) {
	s := &Store{data: map[string]any{}}
	s.Append("sandbox.events", "started")
	s.Append("sandbox.events", "stopped")

	v, ok := s.Get("sandbox.events")
	if !ok {
		t.Fatal("sandbox.events missing")
	}
	list, isList := v.([]any)
	if !isList || len(list) != 2 || list[0] != "started" || list[1] != "stopped" {
		t.Fatalf("sandbox.events = %#v; want [started stopped]", v)
	}
}

func TestAppendReplacesNonList(t *testing.T) {
	s := &Store{data: map[string]any{"x": "scalar"}}
	s.Append("x", "first")
	v, _ := s.Get("x")
	list, isList := v.([]any)
	if !isList || len(list) != 1 || list[0] != "first" {
		t.Fatalf("x = %#v; want [first]", v)
	}
}

func TestAppendHistory(t *testing.T) {
	s := &Store{data: map[string]any{}}
	s.AppendHistory("sbx run")
	s.AppendHistory("sbx stop")
	v, ok := s.Get(HistoryKey)
	if !ok {
		t.Fatal("history missing")
	}
	list := v.([]any)
	if len(list) != 2 || list[0] != "sbx run" || list[1] != "sbx stop" {
		t.Fatalf("history = %#v", v)
	}
}
