package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// runCLI invokes run() with the given args, capturing stdout/stderr via temp
// files (run takes *os.File, not io.Writer). It returns the exit code and the
// combined stdout and stderr text.
func runCLI(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	outF, err := os.CreateTemp(t.TempDir(), "out")
	if err != nil {
		t.Fatalf("temp out: %v", err)
	}
	errF, err := os.CreateTemp(t.TempDir(), "err")
	if err != nil {
		t.Fatalf("temp err: %v", err)
	}
	defer outF.Close()
	defer errF.Close()

	code = run(args, outF, errF)

	ob, _ := os.ReadFile(outF.Name())
	eb, _ := os.ReadFile(errF.Name())
	return code, string(ob), string(eb)
}

func TestSimResetRemovesState(t *testing.T) {
	home := filepath.Join(t.TempDir(), ".sbx-sim")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatalf("mkdir home: %v", err)
	}
	if err := os.WriteFile(filepath.Join(home, "state.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("seed state: %v", err)
	}
	t.Setenv("SBX_SIM_HOME", home)

	code, stdout, _ := runCLI(t, "sim", "reset")
	if code != 0 {
		t.Fatalf("exit = %d; want 0", code)
	}
	if !strings.Contains(stdout, "reset") {
		t.Errorf("unexpected stdout: %q", stdout)
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Errorf("state home should be gone; stat err = %v", err)
	}
}

func TestSimResetWhenAlreadyClear(t *testing.T) {
	home := filepath.Join(t.TempDir(), ".sbx-sim") // never created
	t.Setenv("SBX_SIM_HOME", home)

	code, stdout, _ := runCLI(t, "sim", "reset")
	if code != 0 {
		t.Fatalf("exit = %d; want 0", code)
	}
	if !strings.Contains(stdout, "already clear") {
		t.Errorf("unexpected stdout: %q", stdout)
	}
}

func TestSimResetRejectsExtraArgs(t *testing.T) {
	t.Setenv("SBX_SIM_HOME", filepath.Join(t.TempDir(), ".sbx-sim"))
	code, _, stderr := runCLI(t, "sim", "reset", "extra")
	if code != 1 {
		t.Fatalf("exit = %d; want 1", code)
	}
	if !strings.Contains(stderr, "usage: sbx sim reset") {
		t.Errorf("unexpected stderr: %q", stderr)
	}
}

func TestSimUnknownAndMissingSubcommand(t *testing.T) {
	if code, _, stderr := runCLI(t, "sim", "bogus"); code != 1 || !strings.Contains(stderr, "unknown sim command") {
		t.Errorf("unknown subcommand: code=%d stderr=%q", code, stderr)
	}
	if code, _, stderr := runCLI(t, "sim"); code != 1 || !strings.Contains(stderr, "usage: sbx sim") {
		t.Errorf("missing subcommand: code=%d stderr=%q", code, stderr)
	}
}
