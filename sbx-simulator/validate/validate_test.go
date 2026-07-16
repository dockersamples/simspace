package validate

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/dockersamples/sbx-simulator/manifest"
)

func parse(t *testing.T, src string) *manifest.Lab {
	t.Helper()
	lab, err := manifest.Parse([]byte(src))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return lab
}

// findingsContain reports whether any finding of the given severity mentions
// all of the substrings.
func findingsContain(fs Findings, sev Severity, subs ...string) bool {
	for _, f := range fs {
		if f.Severity != sev {
			continue
		}
		s := f.String()
		all := true
		for _, sub := range subs {
			if !strings.Contains(s, sub) {
				all = false
				break
			}
		}
		if all {
			return true
		}
	}
	return false
}

func TestShippedLabsAreClean(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "testdata", "labs", "*", "sbx-simulator.yaml"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("no shipped labs found")
	}
	for _, p := range paths {
		t.Run(filepath.Base(filepath.Dir(p)), func(t *testing.T) {
			lab, err := manifest.Load(p)
			if err != nil {
				t.Fatalf("load %s: %v", p, err)
			}
			fs := Lab(lab)
			if fs.HasErrors() {
				t.Fatalf("shipped lab %s should have no errors, got: %v", p, fs)
			}
			for _, f := range fs {
				t.Logf("%s: %s", p, f)
			}
		})
	}
}

func TestTopLevelErrors(t *testing.T) {
	lab := parse(t, `
version: ""
metadata: {}
scenarios: []
`)
	fs := Lab(lab)
	if !findingsContain(fs, Error, "version") {
		t.Error("expected missing-version error")
	}
	if !findingsContain(fs, Error, "metadata", "id") {
		t.Error("expected missing metadata id error")
	}
	if !findingsContain(fs, Error, "metadata", "title") {
		t.Error("expected missing metadata title error")
	}
	if !findingsContain(fs, Error, "at least one scenario") {
		t.Error("expected empty-scenarios error")
	}
}

func TestDuplicateAndMissingIDs(t *testing.T) {
	lab := parse(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: dup
    when: { command: a }
    then: { output: ["x"] }
  - id: dup
    when: { command: b }
    then: { output: ["y"] }
  - when: { command: c }
    then: { output: ["z"] }
`)
	fs := Lab(lab)
	if !findingsContain(fs, Error, "duplicate id") {
		t.Error("expected duplicate id error")
	}
	if !findingsContain(fs, Error, "scenarios[2]", "missing `id`") {
		t.Error("expected missing id error")
	}
}

func TestFileOpChecks(t *testing.T) {
	lab := parse(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: bad-escape
    when: { command: a }
    then:
      files:
        - create: "../evil.txt"
          content: "x"
  - id: bad-replace
    when: { command: b }
    then:
      files:
        - replace: "f.txt"
  - id: bad-copy
    when: { command: c }
    then:
      files:
        - copy: "a.txt"
  - id: no-verb
    when: { command: d }
    then:
      files:
        - content: "orphan"
  - id: ignored-field
    when: { command: e }
    then:
      files:
        - delete: "gone.txt"
          content: "ignored"
`)
	fs := Lab(lab)
	if !findingsContain(fs, Error, "bad-escape", "escapes lab root") {
		t.Error("expected escape error")
	}
	if !findingsContain(fs, Error, "bad-replace", "requires a non-empty `find`") {
		t.Error("expected replace-find error")
	}
	if !findingsContain(fs, Error, "bad-copy", "requires a `to`") {
		t.Error("expected copy-to error")
	}
	if !findingsContain(fs, Error, "no-verb", "no operation verb") {
		t.Error("expected no-verb error")
	}
	if !findingsContain(fs, Warning, "ignored-field", "ignored by `delete`") {
		t.Error("expected ignored-field warning")
	}
}

func TestReachabilityShadowing(t *testing.T) {
	lab := parse(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: catch-all-run
    when: { command: run }
    then: { output: ["generic"] }
  - id: specific-run
    when:
      command: run
      state: { sandbox.running: true }
    then: { output: ["specific"] }
`)
	fs := Lab(lab)
	if !findingsContain(fs, Warning, "specific-run", "unreachable", "catch-all-run") {
		t.Fatalf("expected unreachable warning, got: %v", fs)
	}
}

func TestReachabilityNoFalsePositive(t *testing.T) {
	// Same command but mutually exclusive state -> neither shadows the other.
	lab := parse(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: run-stopped
    when:
      command: run
      state: { sandbox.running: false }
    then: { output: ["a"] }
  - id: run-started
    when:
      command: run
      state: { sandbox.running: true }
    then: { output: ["b"] }
`)
	fs := Lab(lab)
	for _, f := range fs {
		if f.Severity == Warning && strings.Contains(f.Message, "unreachable") {
			t.Fatalf("false positive unreachable warning: %s", f)
		}
	}
}

func TestAgentWhenConflicts(t *testing.T) {
	lab := parse(t, `
version: "1.1"
metadata: { id: t, title: t }
scenarios:
  - id: both-dispatch
    when: { command: run, agent: true }
    then: { output: ["x"] }
  - id: both-prompt
    when: { agent: true, prompt: "hi", promptContains: [hi] }
    then: { output: ["y"] }
  - id: keyword-on-command
    when: { command: run, promptContains: [hi] }
    then: { output: ["z"] }
  - id: args-on-agent
    when: { agent: true, args: { 0: "x" } }
    then: { output: ["w"] }
`)
	fs := Lab(lab)
	if !findingsContain(fs, Error, "both-dispatch", "mutually exclusive") {
		t.Error("expected command+agent error")
	}
	if !findingsContain(fs, Error, "both-prompt", "only one of `prompt` or `promptContains`") {
		t.Error("expected prompt+promptContains error")
	}
	if !findingsContain(fs, Warning, "keyword-on-command", "`promptContains` is ignored") {
		t.Error("expected promptContains-ignored warning")
	}
	if !findingsContain(fs, Warning, "args-on-agent", "`args` is ignored") {
		t.Error("expected args-ignored warning")
	}
}

func TestAgentReachabilityShadowing(t *testing.T) {
	lab := parse(t, `
version: "1.1"
metadata: { id: t, title: t }
scenarios:
  - id: agent-catchall
    when: { agent: true }
    then: { output: ["dunno"] }
  - id: agent-keyword
    when: { agent: true, promptContains: [health] }
    then: { output: ["health"] }
`)
	fs := Lab(lab)
	if !findingsContain(fs, Warning, "agent-keyword", "unreachable", "agent-catchall") {
		t.Fatalf("expected agent catch-all to shadow keyword scenario, got: %v", fs)
	}
}

func TestAgentReachabilityNoFalsePositive(t *testing.T) {
	// Same keyword, mutually exclusive state -> no shadowing. And a command
	// scenario never shadows an agent scenario.
	lab := parse(t, `
version: "1.1"
metadata: { id: t, title: t }
scenarios:
  - id: cmd-run
    when: { command: run }
    then: { output: ["run"] }
  - id: agent-health-off
    when: { agent: true, promptContains: [health], state: { app.hasHealth: false } }
    then: { output: ["a"] }
  - id: agent-health-on
    when: { agent: true, promptContains: [health], state: { app.hasHealth: true } }
    then: { output: ["b"] }
`)
	fs := Lab(lab)
	for _, f := range fs {
		if f.Severity == Warning && strings.Contains(f.Message, "unreachable") {
			t.Fatalf("false positive unreachable warning: %s", f)
		}
	}
}

func TestReachabilityExactPromptNotShadowed(t *testing.T) {
	// A bare agent-run catch-all placed AFTER a specific prompt is fine; but a
	// specific prompt placed after the catch-all is unreachable.
	lab := parse(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: agent-catchall
    when: { command: [agent, run] }
    then: { output: ["dunno"] }
  - id: agent-specific
    when:
      command: [agent, run]
      prompt: "do the thing"
    then: { output: ["doing"] }
`)
	fs := Lab(lab)
	if !findingsContain(fs, Warning, "agent-specific", "unreachable") {
		t.Fatalf("expected specific prompt after catch-all to be unreachable, got: %v", fs)
	}
}
