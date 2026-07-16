package session

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
	"github.com/dockersamples/sbx-simulator/state"
)

// setup loads the interactive-agent lab and fires its `run` scenario to obtain
// the session config plus a ready fs/state, mirroring what the CLI does.
func setup(t *testing.T) (*manifest.Lab, *manifest.Session, *filesystem.FS, *state.Store, string) {
	t.Helper()
	lab, err := manifest.Load(filepath.Join("..", "testdata", "labs", "interactive-agent", "sbx-simulator.yaml"))
	if err != nil {
		t.Fatalf("load lab: %v", err)
	}
	root := t.TempDir()
	fs, err := filesystem.New(root)
	if err != nil {
		t.Fatalf("fs: %v", err)
	}
	st, err := state.Load(filepath.Join(root, ".sbx-sim"), lab.State)
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	// Find the run scenario's session config.
	var sess *manifest.Session
	for i := range lab.Scenarios {
		if lab.Scenarios[i].ID == "run" {
			sess = lab.Scenarios[i].Then.Session
		}
	}
	if sess == nil {
		t.Fatal("run scenario has no session")
	}
	return lab, sess, fs, st, root
}

func TestREPLDrivesTurnsAndPersistsState(t *testing.T) {
	lab, sess, fs, st, root := setup(t)

	in := strings.NewReader("add a health endpoint\nadd a health endpoint\nadd tests\n/exit\n")
	var out, errOut bytes.Buffer
	opts := Options{Stream: false}

	if err := Run(lab, sess, fs, st, in, &out, &errOut, opts); err != nil {
		t.Fatalf("Run: %v", err)
	}

	got := out.String()
	for _, want := range []string{
		"Agent ready.",                                     // intro
		"Adding a GET /health endpoint",                    // first health turn
		"The /health endpoint is already in app/server.js", // second, state-gated
		"Adding a test file",                               // tests turn
		"Agent session ended.",                             // outro
	} {
		if !strings.Contains(got, want) {
			t.Errorf("output missing %q; got:\n%s", want, got)
		}
	}

	// The health endpoint was appended exactly once (second turn was a no-op).
	raw, err := readFile(root, "app/server.js")
	if err != nil {
		t.Fatalf("read server.js: %v", err)
	}
	if n := strings.Count(raw, "/health"); n != 1 {
		t.Errorf("/health appears %d times; want 1", n)
	}
	if _, err := readFile(root, "app/server.test.js"); err != nil {
		t.Errorf("test file not created: %v", err)
	}

	// State reflects both features.
	if v, _ := st.Get("app.hasHealth"); v != true {
		t.Errorf("app.hasHealth = %v; want true", v)
	}
	if v, _ := st.Get("app.hasTests"); v != true {
		t.Errorf("app.hasTests = %v; want true", v)
	}
}

func TestREPLPromptsPrinted(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	in := strings.NewReader("/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out.String(), "agent> ") {
		t.Errorf("expected the REPL prompt in output; got:\n%s", out.String())
	}
}

func TestREPLEndsOnEOF(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	// No /exit, just EOF after one prompt.
	in := strings.NewReader("add tests\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out.String(), "Agent session ended.") {
		t.Error("session should end (and print outro) on EOF")
	}
}

func TestOnceOneShot(t *testing.T) {
	lab, _, fs, st, root := setup(t)
	var out, errOut bytes.Buffer
	exit, err := Once(lab, "add a health endpoint", fs, st, &out, &errOut, Options{Stream: false})
	if err != nil {
		t.Fatalf("Once: %v", err)
	}
	if exit != 0 {
		t.Errorf("exit = %d; want 0", exit)
	}
	if !strings.Contains(out.String(), "Adding a GET /health endpoint") {
		t.Errorf("unexpected output: %s", out.String())
	}
	raw, _ := readFile(root, "app/server.js")
	if !strings.Contains(raw, "/health") {
		t.Error("one-shot did not modify the file")
	}
}

func TestOnceUnmatchedUsesDefault(t *testing.T) {
	lab, _, fs, st, _ := setup(t)
	var out, errOut bytes.Buffer
	if _, err := Once(lab, "make me a sandwich", fs, st, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Once: %v", err)
	}
	if !strings.Contains(out.String(), "I can add a /health endpoint or add tests") {
		t.Errorf("expected unmatchedAgent default; got: %s", out.String())
	}
}

func TestREPLPrintsWelcomeBanner(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	in := strings.NewReader("/exit\n")
	var out, errOut bytes.Buffer
	// Streaming off → plain text, no ANSI escapes (assertion-friendly).
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	got := out.String()
	for _, want := range []string{
		"SBX Simulator · Agent Session", // title
		"Simulated environment",         // scripted disclaimer
		`\___/`,                         // Docker whale
	} {
		if !strings.Contains(got, want) {
			t.Errorf("banner missing %q; got:\n%s", want, got)
		}
	}
	if strings.Contains(got, "\033[") {
		t.Errorf("banner should be plain (no ANSI) when not streaming; got:\n%s", got)
	}
}

func TestBannerColorsWhenStreaming(t *testing.T) {
	var buf bytes.Buffer
	banner(&buf, Options{Stream: true})
	if !strings.Contains(buf.String(), "\033[") {
		t.Errorf("banner should emit ANSI colour when streaming; got:\n%s", buf.String())
	}
}

func TestThinkNoOpWhenNotStreaming(t *testing.T) {
	var buf bytes.Buffer
	think(&buf, Options{Stream: false, Think: 500 * time.Millisecond})
	if buf.Len() != 0 {
		t.Errorf("think should emit nothing when not streaming; got %q", buf.String())
	}
}

func TestThinkShowsAndClears(t *testing.T) {
	var buf bytes.Buffer
	think(&buf, Options{Stream: true, Think: 30 * time.Millisecond})
	out := buf.String()
	if !strings.Contains(out, "Evaluating...") {
		t.Errorf("expected spinner text; got %q", out)
	}
	// The line is cleared at the end (trailing carriage return, no leftover text).
	if !strings.HasSuffix(out, "\r") {
		t.Errorf("spinner should clear its line; got %q", out)
	}
}

func TestShellModeRunsRealCommand(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	// A `!`-prefixed line is executed as a real shell command; its output is
	// streamed verbatim and the session continues.
	in := strings.NewReader("!echo hello from shell\n/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out.String(), "hello from shell") {
		t.Errorf("shell output missing; got:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "Agent session ended.") {
		t.Error("session should continue past a shell command and print the outro")
	}
}

func TestShellModeRunsInLabRoot(t *testing.T) {
	lab, sess, fs, st, root := setup(t)
	in := strings.NewReader("!pwd\n/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// The command's working directory is the lab root. Resolve symlinks on both
	// sides so /var vs /private/var (macOS) doesn't cause a spurious mismatch.
	wantRoot, _ := filepath.EvalSymlinks(root)
	if !strings.Contains(out.String(), wantRoot) {
		t.Errorf("shell cwd = %q; want lab root %q", strings.TrimSpace(out.String()), wantRoot)
	}
}

func TestShellModeEmptyShowsUsage(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	in := strings.NewReader("!\n/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(errOut.String(), "usage: !<command>") {
		t.Errorf("expected usage hint for a bare !; got:\n%s", errOut.String())
	}
}

func TestShellModeReportsNonZeroExit(t *testing.T) {
	lab, sess, fs, st, _ := setup(t)
	in := strings.NewReader("!exit 3\n/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(errOut.String(), "status 3") {
		t.Errorf("expected non-zero exit status reported; got:\n%s", errOut.String())
	}
}

func TestShellModeUsesScenarioWhenDefined(t *testing.T) {
	lab, err := manifest.Parse([]byte(`
version: "1.1"
metadata: { id: t, title: t }
scenarios:
  - id: run
    when: { command: run }
    then:
      session:
        prompt: "agent> "
        intro: ["ready"]
        outro: ["bye"]
  - id: shell-cat
    when:
      shell: true
      prompt: "cat secret.txt"
    then:
      output: ["MOCKED: pretend contents"]
      state: { peeked: true }
`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var sess *manifest.Session
	for i := range lab.Scenarios {
		if lab.Scenarios[i].ID == "run" {
			sess = lab.Scenarios[i].Then.Session
		}
	}
	root := t.TempDir()
	fs, _ := filesystem.New(root)
	st, _ := state.Load(filepath.Join(root, ".sbx-sim"), lab.State)

	// A real `cat secret.txt` would fail (the file does not exist); the shell
	// scenario must intercept it instead. `!echo real` has no shell scenario, so
	// it falls back to running the real command.
	in := strings.NewReader("!cat secret.txt\n!echo real-fallback\n/exit\n")
	var out, errOut bytes.Buffer
	if err := Run(lab, sess, fs, st, in, &out, &errOut, Options{Stream: false}); err != nil {
		t.Fatalf("Run: %v", err)
	}

	if !strings.Contains(out.String(), "MOCKED: pretend contents") {
		t.Errorf("expected mocked shell output; got:\n%s", out.String())
	}
	if strings.Contains(errOut.String(), "secret.txt") {
		t.Errorf("real `cat` should not have run; stderr:\n%s", errOut.String())
	}
	if v, _ := st.Get("peeked"); v != true {
		t.Errorf("shell scenario state effect not applied: peeked = %v; want true", v)
	}
	// Unmatched `!echo` falls back to the real shell.
	if !strings.Contains(out.String(), "real-fallback") {
		t.Errorf("expected real-shell fallback output; got:\n%s", out.String())
	}
}

func readFile(root, rel string) (string, error) {
	b, err := os.ReadFile(filepath.Join(root, rel))
	return string(b), err
}
