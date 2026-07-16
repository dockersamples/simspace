package filesystem

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConfinesWritesToRoot(t *testing.T) {
	root := t.TempDir()
	fs, err := New(root)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := fs.Create("app/hello.txt", "hi"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(root, "app", "hello.txt"))
	if err != nil || string(got) != "hi" {
		t.Fatalf("file = %q, err = %v", got, err)
	}
}

func TestRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	fs, _ := New(root)

	bad := []string{
		"../escape.txt",
		"a/../../escape.txt",
		"/etc/passwd",
	}
	for _, p := range bad {
		if err := fs.Create(p, "x"); err == nil {
			t.Errorf("Create(%q) should have been rejected", p)
		}
	}
}

func TestRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics differ on windows")
	}
	root := t.TempDir()
	outside := t.TempDir()
	// A symlink inside the root pointing outside it.
	link := filepath.Join(root, "out")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	fs, _ := New(root)

	if err := fs.Create("out/escape.txt", "x"); err == nil {
		t.Error("write through escaping symlink should be rejected")
	}
	if _, err := os.Stat(filepath.Join(outside, "escape.txt")); !os.IsNotExist(err) {
		t.Error("file leaked outside root via symlink")
	}
}

func TestReplaceRequiresFindAndMatch(t *testing.T) {
	root := t.TempDir()
	fs, _ := New(root)
	if err := fs.Create("f.txt", "PORT = 3000\n"); err != nil {
		t.Fatal(err)
	}

	if err := fs.Replace("f.txt", "", "x"); err == nil {
		t.Error("empty find should error")
	}
	if err := fs.Replace("f.txt", "NOPE", "x"); err == nil {
		t.Error("missing text should error")
	}
	if err := fs.Replace("f.txt", "3000", "8080"); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(root, "f.txt"))
	if string(got) != "PORT = 8080\n" {
		t.Errorf("content = %q", got)
	}
}
