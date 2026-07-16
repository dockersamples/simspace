package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dockersamples/sbx-simulator/commands"
	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
	"github.com/dockersamples/sbx-simulator/state"
)

// step drives one command and asserts its output/exit.
type step struct {
	args       []string
	wantStdout []string
	wantStderr []string
	wantExit   int
	wantID     string
}

// TestSandboxLifecycleGolden drives the shipped example lab through a full
// lifecycle, asserting output, exit codes, matched scenarios, resulting files,
// and persisted state. This is the end-to-end regression guard for the engine.
func TestSandboxLifecycleGolden(t *testing.T) {
	lab, err := manifest.Load(filepath.Join("..", "testdata", "labs", "sandbox-lifecycle", "sbx-simulator.yaml"))
	if err != nil {
		t.Fatalf("load lab: %v", err)
	}

	root := t.TempDir()
	home := filepath.Join(root, ".sbx-sim")
	fs, err := filesystem.New(root)
	if err != nil {
		t.Fatalf("fs: %v", err)
	}

	steps := []step{
		{args: []string{"status"}, wantStdout: []string{"No sandbox is running."}, wantID: "status-stopped"},
		{args: []string{"run"}, wantStdout: []string{"Starting sandbox...", "Sandbox is running. View logs with: sbx logs"}, wantID: "run-start"},
		{args: []string{"status"}, wantStdout: []string{"NAME    STATE     UPTIME", "web     running   0m2s"}, wantID: "status-running"},
		{args: []string{"logs"}, wantStdout: []string{"[sim] sandbox started"}, wantID: "logs"},
		{args: []string{"run"}, wantStderr: []string{"Error: a sandbox is already running."}, wantExit: 1, wantID: "run-already"},
		{args: []string{"stop"}, wantStdout: []string{"Sandbox stopped."}, wantID: "stop"},
		{args: []string{"status"}, wantStdout: []string{"No sandbox is running."}, wantID: "status-stopped"},
		{args: []string{"frobnicate"}, wantStderr: []string{"Error: that command isn't part of this lab yet."}, wantExit: 1, wantID: ""},
	}

	for i, s := range steps {
		// Each command is a fresh process in production, so reload state from
		// disk every step to exercise persistence.
		st, err := state.Load(home, lab.State)
		if err != nil {
			t.Fatalf("step %d load state: %v", i, err)
		}
		res, err := Run(lab, commands.Parse(s.args), fs, st)
		if err != nil {
			t.Fatalf("step %d %v: %v", i, s.args, err)
		}
		if err := st.Save(); err != nil {
			t.Fatalf("step %d save: %v", i, err)
		}

		if got := strings.Join(res.Stdout, "\n"); got != strings.Join(s.wantStdout, "\n") {
			t.Errorf("step %d %v stdout = %q; want %q", i, s.args, got, strings.Join(s.wantStdout, "\n"))
		}
		if got := strings.Join(res.Stderr, "\n"); got != strings.Join(s.wantStderr, "\n") {
			t.Errorf("step %d %v stderr = %q; want %q", i, s.args, got, strings.Join(s.wantStderr, "\n"))
		}
		if res.Exit != s.wantExit {
			t.Errorf("step %d %v exit = %d; want %d", i, s.args, res.Exit, s.wantExit)
		}
		if res.Matched != s.wantID {
			t.Errorf("step %d %v matched = %q; want %q", i, s.args, res.Matched, s.wantID)
		}
	}

	// The run scenario should have created the log file with expected content.
	logPath := filepath.Join(root, "logs", "sandbox.log")
	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if string(raw) != "[sim] sandbox started\n" {
		t.Errorf("log content = %q", string(raw))
	}

	// Final persisted state: stopped, phase done.
	final, err := state.Load(home, lab.State)
	if err != nil {
		t.Fatalf("final load: %v", err)
	}
	if v, _ := final.Get("sandbox.running"); v != false {
		t.Errorf("final sandbox.running = %v; want false", v)
	}
	if v, _ := final.Get("phase"); v != "done" {
		t.Errorf("final phase = %v; want done", v)
	}
}

// TestTemplatingCaptureAndState verifies {{ args.* }} / {{ state.* }} rendering
// through a full Run, including a captured arg flowing into state and output.
func TestRunShell(t *testing.T) {
	lab, err := manifest.Parse([]byte(`
version: "1.1"
metadata: { id: t, title: t }
scenarios:
  - id: shell-touch
    when:
      shell: true
      prompt: "touch marker"
    then:
      files:
        - create: "marker"
          content: "made by a shell scenario\n"
      state: { app.marked: true }
      output: ["created marker"]
`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	root := t.TempDir()
	fs, _ := filesystem.New(root)
	st, _ := state.Load(filepath.Join(root, ".sbx-sim"), lab.State)

	// A matching shell scenario applies its effects and returns a Result.
	res, err := RunShell(lab, "touch marker", fs, st)
	if err != nil {
		t.Fatalf("RunShell: %v", err)
	}
	if res == nil || res.Matched != "shell-touch" {
		t.Fatalf("matched = %v; want shell-touch", res)
	}
	if strings.Join(res.Stdout, "\n") != "created marker" {
		t.Errorf("stdout = %q; want [created marker]", res.Stdout)
	}
	if _, err := os.Stat(filepath.Join(root, "marker")); err != nil {
		t.Errorf("expected marker file to be created: %v", err)
	}
	if v, _ := st.Get("app.marked"); v != true {
		t.Errorf("app.marked = %v; want true", v)
	}

	// No matching shell scenario -> nil Result, nil error, so the caller can
	// fall back to running the real command.
	res, err = RunShell(lab, "cat something-else", fs, st)
	if err != nil {
		t.Fatalf("RunShell (unmatched): %v", err)
	}
	if res != nil {
		t.Fatalf("unmatched RunShell = %v; want nil", res)
	}
}

func TestTemplatingCaptureAndState(t *testing.T) {
	lab, err := manifest.Parse([]byte(`
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: run-named
    when:
      command: run
      args: { 0: { any: true } }
    then:
      state:
        sandbox.name: "{{ args.0 }}"
        sandbox.running: true
      output:
        - "Starting '{{ args.0 }}'..."
        - "State now: {{ state.sandbox.running }}"
`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	root := t.TempDir()
	fs, _ := filesystem.New(root)
	st, _ := state.Load(filepath.Join(root, ".sbx-sim"), lab.State)

	res, err := Run(lab, commands.Parse([]string{"run", "web"}), fs, st)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	want := []string{"Starting 'web'...", "State now: true"}
	if strings.Join(res.Stdout, "\n") != strings.Join(want, "\n") {
		t.Errorf("stdout = %q; want %q", res.Stdout, want)
	}
	if v, _ := st.Get("sandbox.name"); v != "web" {
		t.Errorf("sandbox.name = %v; want web", v)
	}
}
