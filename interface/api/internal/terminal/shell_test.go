//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
	"testing"
)

// makeStubExec creates a minimal executable shell script at dir/name.
func makeStubExec(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("makeStubExec: %v", err)
	}
	return path
}

func TestDetectShell_SHELLEnvVar(t *testing.T) {
	dir := t.TempDir()
	stub := makeStubExec(t, dir, "myshell")

	t.Setenv("SHELL", stub)
	// Prepend dir to PATH so LookPath finds the stub.
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	got := detectShell()
	if got != stub {
		t.Errorf("detectShell() = %q; want %q (from $SHELL)", got, stub)
	}
}

func TestDetectShell_FallbackToBash(t *testing.T) {
	dir := t.TempDir()
	// Create a bash stub but no myshell; unset SHELL to force fallback.
	stub := makeStubExec(t, dir, "bash")

	t.Setenv("SHELL", "")
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	got := detectShell()
	if got != stub {
		t.Errorf("detectShell() = %q; want %q (bash fallback)", got, stub)
	}
}

func TestDetectShell_FallbackToSh(t *testing.T) {
	dir := t.TempDir()
	// Create only an sh stub; no bash, no $SHELL.
	stub := makeStubExec(t, dir, "sh")

	t.Setenv("SHELL", "")
	// Use only our temp dir on PATH so bash is not found.
	t.Setenv("PATH", dir)

	got := detectShell()
	if got != stub {
		t.Errorf("detectShell() = %q; want %q (sh fallback)", got, stub)
	}
}

func TestDetectShell_HardcodedFallback(t *testing.T) {
	// Empty PATH, empty SHELL — should fall back to /bin/sh.
	t.Setenv("SHELL", "")
	t.Setenv("PATH", "")

	got := detectShell()
	if got != "/bin/sh" {
		t.Errorf("detectShell() = %q; want /bin/sh (hard-coded fallback)", got)
	}
}

func TestDetectShell_InvalidSHELLFallsBack(t *testing.T) {
	dir := t.TempDir()
	bash := makeStubExec(t, dir, "bash")

	// SHELL points to something that doesn't exist — should fall through to bash.
	t.Setenv("SHELL", "/nonexistent/shell")
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	got := detectShell()
	if got != bash {
		t.Errorf("detectShell() = %q; want %q (bash after invalid $SHELL)", got, bash)
	}
}
