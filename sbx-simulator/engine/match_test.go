package engine

import (
	"testing"

	"github.com/dockersamples/sbx-simulator/commands"
	"github.com/dockersamples/sbx-simulator/manifest"
)

// fakeState is a minimal StateReader backed by a flat dot-path map.
type fakeState map[string]any

func (f fakeState) Get(path string) (any, bool) {
	v, ok := f[path]
	return v, ok
}

func parseLab(t *testing.T, src string) *manifest.Lab {
	t.Helper()
	lab, err := manifest.Parse([]byte(src))
	if err != nil {
		t.Fatalf("parse lab: %v", err)
	}
	return lab
}

func TestMatchFirstWinsAndStateGates(t *testing.T) {
	lab := parseLab(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: run-start
    when:
      command: run
      state: { sandbox.running: false }
    then:
      output: ["Starting sandbox..."]
  - id: run-already
    when:
      command: run
      state: { sandbox.running: true }
    then:
      stderr: ["already running"]
`)

	// sandbox stopped -> run-start
	res := Match(lab, commands.Parse([]string{"run"}), fakeState{})
	if res == nil || res.Scenario.ID != "run-start" {
		t.Fatalf("stopped: got %v; want run-start", idOf(res))
	}

	// sandbox running -> run-already
	res = Match(lab, commands.Parse([]string{"run"}), fakeState{"sandbox.running": true})
	if res == nil || res.Scenario.ID != "run-already" {
		t.Fatalf("running: got %v; want run-already", idOf(res))
	}
}

func TestMatchCommandPrefixAndNoMatch(t *testing.T) {
	lab := parseLab(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: policy-allow
    when:
      command: [policy, allow, network]
    then:
      output: ["allowed"]
`)

	res := Match(lab, commands.Parse([]string{"policy", "allow", "network", "example.com"}), fakeState{})
	if res == nil || res.Scenario.ID != "policy-allow" {
		t.Fatalf("got %v; want policy-allow", idOf(res))
	}

	// Different subcommand does not match.
	if res := Match(lab, commands.Parse([]string{"policy", "deny"}), fakeState{}); res != nil {
		t.Fatalf("policy deny should not match, got %s", res.Scenario.ID)
	}
}

func TestMatchArgMatchersAndCapture(t *testing.T) {
	lab := parseLab(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: run-named
    when:
      command: run
      args:
        0: { any: true }
        detach: true
    then:
      output: ["ok"]
`)

	res := Match(lab, commands.Parse([]string{"run", "web", "--detach"}), fakeState{})
	if res == nil {
		t.Fatal("expected match")
	}
	if got := res.Args["0"]; got != "web" {
		t.Fatalf("captured arg 0 = %q; want web", got)
	}

	// Missing required boolean flag -> no match.
	if res := Match(lab, commands.Parse([]string{"run", "web"}), fakeState{}); res != nil {
		t.Fatalf("missing --detach should not match, got %s", res.Scenario.ID)
	}
}

func TestMatchEqualsOneOfAbsent(t *testing.T) {
	lab := parseLab(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: s
    when:
      command: run
      args:
        name: "web"
        count: { oneOf: ["1", "2"] }
        verbose: false
    then:
      output: ["ok"]
`)

	ok := Match(lab, commands.Parse([]string{"run", "--name=web", "--count=2"}), fakeState{})
	if ok == nil {
		t.Fatal("expected match with name=web count=2 and no verbose")
	}

	// verbose present -> absent matcher fails.
	if res := Match(lab, commands.Parse([]string{"run", "--name=web", "--count=2", "--verbose"}), fakeState{}); res != nil {
		t.Fatal("verbose present should fail absent matcher")
	}

	// count out of set -> fails.
	if res := Match(lab, commands.Parse([]string{"run", "--name=web", "--count=9"}), fakeState{}); res != nil {
		t.Fatal("count=9 should fail oneOf")
	}
}

func TestMatchExactPrompt(t *testing.T) {
	lab := parseLab(t, `
version: "1.0"
metadata: { id: t, title: t }
scenarios:
  - id: specific
    when:
      command: [agent, run]
      prompt: "Add a /health endpoint that returns 200"
    then:
      output: ["adding health"]
  - id: fallback
    when:
      command: [agent, run]
    then:
      output: ["I don't know how to do that in this lab"]
`)

	res := Match(lab, commands.Parse([]string{"agent", "run", "Add a /health endpoint that returns 200"}), fakeState{})
	if res == nil || res.Scenario.ID != "specific" {
		t.Fatalf("exact prompt: got %v; want specific", idOf(res))
	}

	res = Match(lab, commands.Parse([]string{"agent", "run", "something else"}), fakeState{})
	if res == nil || res.Scenario.ID != "fallback" {
		t.Fatalf("other prompt: got %v; want fallback", idOf(res))
	}
}

func TestStateEqualNumericAndZero(t *testing.T) {
	// int expected (from YAML) vs float64 actual (from JSON state) must match.
	if !stateEqual(2, float64(2), true) {
		t.Error("2 (int) should equal 2.0 (float64)")
	}
	// zero expectation matches a missing key.
	if !stateEqual(false, nil, false) {
		t.Error("false should match a missing key")
	}
	// non-zero expectation does not match a missing key.
	if stateEqual(true, nil, false) {
		t.Error("true should not match a missing key")
	}
	// type-distinct: string "false" != bool false.
	if jsonEqual("false", false) {
		t.Error(`"false" should not equal false`)
	}
}

func idOf(r *MatchResult) string {
	if r == nil {
		return "<nil>"
	}
	return r.Scenario.ID
}
