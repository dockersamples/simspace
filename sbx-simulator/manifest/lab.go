// Package manifest defines the sbx-simulator.yaml schema and loads it. The
// manifest is the contract between Labspaces, the lab author, and the engine.
// See docs/scenario-spec.md.
package manifest

import (
	"bytes"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// SchemaVersion is the scenario schema version this build understands.
const SchemaVersion = "1.1"

// Lab is a parsed sbx-simulator.yaml.
type Lab struct {
	Version       string         `yaml:"version"`
	Metadata      Metadata       `yaml:"metadata"`
	Compatibility Compatibility  `yaml:"compatibility"`
	Objectives    []string       `yaml:"objectives"`
	State         map[string]any `yaml:"state"`
	Settings      Settings       `yaml:"settings"`
	Defaults      Defaults       `yaml:"defaults"`
	Scenarios     []Scenario     `yaml:"scenarios"`
}

// Settings holds presentation options. Streaming and the agent "thinking"
// spinner are cosmetic and never change what is printed, so labs remain
// deterministic.
type Settings struct {
	// Streaming enables line-by-line streamed output. Nil means "unset";
	// StreamingEnabled applies the default (true).
	Streaming *bool `yaml:"streaming"`
	// StreamDelayMs is the per-line delay while streaming (default 20).
	StreamDelayMs *int `yaml:"streamDelayMs"`
	// AgentThinkMs is how long the "Evaluating..." spinner shows before an
	// agent response (default 700). 0 disables it.
	AgentThinkMs *int `yaml:"agentThinkMs"`
}

// StreamingEnabled reports whether streaming is on, defaulting to true.
func (s Settings) StreamingEnabled() bool {
	return s.Streaming == nil || *s.Streaming
}

// DelayMs returns the configured per-line stream delay, defaulting to 20ms.
func (s Settings) DelayMs() int {
	if s.StreamDelayMs == nil {
		return 20
	}
	return *s.StreamDelayMs
}

// ThinkMs returns the agent "thinking" spinner duration, defaulting to 700ms.
func (s Settings) ThinkMs() int {
	if s.AgentThinkMs == nil {
		return 700
	}
	return *s.AgentThinkMs
}

// Metadata is catalog/display information, opaque to the engine.
type Metadata struct {
	ID      string   `yaml:"id"`
	Title   string   `yaml:"title"`
	Summary string   `yaml:"summary"`
	Authors []string `yaml:"authors"`
}

// Compatibility constrains which simulator versions may run the lab.
type Compatibility struct {
	Simulator string `yaml:"simulator"`
}

// Defaults holds behavior applied across scenarios.
type Defaults struct {
	Unmatched      *Then `yaml:"unmatched"`
	UnmatchedAgent *Then `yaml:"unmatchedAgent"`
	Exit           *int  `yaml:"exit"`
}

// Scenario is one ordered match rule.
type Scenario struct {
	ID          string `yaml:"id"`
	Description string `yaml:"description"`
	When        When   `yaml:"when"`
	Then        Then   `yaml:"then"`
}

// When holds the conditions that must all hold for a scenario to fire.
type When struct {
	Command CommandPath        `yaml:"command"`
	Args    map[string]Matcher `yaml:"args"`
	Agent   bool               `yaml:"agent"`
	// Shell marks a scenario matched against a `!cmd` shell escape typed in a
	// session, rather than a CLI command or an agent prompt (see §6.6, §12.4).
	Shell          bool           `yaml:"shell"`
	Prompt         *string        `yaml:"prompt"`
	PromptContains []string       `yaml:"promptContains"`
	State          map[string]any `yaml:"state"`
}

// Then holds the effects applied when a scenario fires. Order of application is
// files -> state -> output/stderr -> mcp (see docs/scenario-spec.md §7).
type Then struct {
	Files   []FileOp       `yaml:"files"`
	State   map[string]any `yaml:"state"`
	Output  []string       `yaml:"output"`
	Stderr  []string       `yaml:"stderr"`
	Exit    *int           `yaml:"exit"`
	MCP     []MCPCall      `yaml:"mcp"`
	Session *Session       `yaml:"session"`
}

// Session, when set on a fired command scenario, makes the simulator enter an
// interactive agent REPL after applying the scenario's other effects.
type Session struct {
	Intro  []string `yaml:"intro"`
	Prompt string   `yaml:"prompt"`
	Outro  []string `yaml:"outro"`
}

// PromptString returns the REPL input prompt, defaulting to "> ".
func (s *Session) PromptString() string {
	if s.Prompt == "" {
		return "> "
	}
	return s.Prompt
}

// FileOp is a single filesystem mutation. Exactly one operation verb is set.
type FileOp struct {
	Mkdir   string `yaml:"mkdir"`
	Create  string `yaml:"create"`
	Append  string `yaml:"append"`
	Replace string `yaml:"replace"`
	Delete  string `yaml:"delete"`
	Copy    string `yaml:"copy"`

	Content string `yaml:"content"` // for create/append
	Find    string `yaml:"find"`    // for replace
	With    string `yaml:"with"`    // for replace
	To      string `yaml:"to"`      // for copy
}

// MCPCall is a mocked MCP tool invocation rendered as sbx-style output.
type MCPCall struct {
	Tool      string         `yaml:"tool"`
	Arguments map[string]any `yaml:"arguments"`
	Result    string         `yaml:"result"`
}

// OpVerb is one filesystem operation verb parsed from a FileOp, with its
// primary target path.
type OpVerb struct {
	Name string // "mkdir", "create", "append", "replace", "delete", "copy"
	Path string
}

// Verbs returns the operation verbs set on op — normally exactly one. Zero or
// more than one indicates an authoring error the validator reports.
func (op FileOp) Verbs() []OpVerb {
	var verbs []OpVerb
	add := func(name, path string) {
		if path != "" {
			verbs = append(verbs, OpVerb{Name: name, Path: path})
		}
	}
	add("mkdir", op.Mkdir)
	add("create", op.Create)
	add("append", op.Append)
	add("replace", op.Replace)
	add("delete", op.Delete)
	add("copy", op.Copy)
	return verbs
}

// CheckSchemaVersion reports whether a lab's declared schema version is
// compatible with this build. v1.0 accepts any 1.x manifest.
func CheckSchemaVersion(v string) error {
	if v == "" {
		return fmt.Errorf("sbx-simulator.yaml is missing a `version` field")
	}
	major, _, _ := strings.Cut(v, ".")
	want, _, _ := strings.Cut(SchemaVersion, ".")
	if major != want {
		return fmt.Errorf("lab schema version %q is incompatible with simulator schema %q", v, SchemaVersion)
	}
	return nil
}

// Load reads and parses a sbx-simulator.yaml from path with strict decoding,
// so unknown keys (typos) surface as errors rather than being silently
// ignored.
func Load(path string) (*Lab, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read lab %s: %w", path, err)
	}
	return Parse(raw)
}

// Parse decodes sbx-simulator.yaml bytes with strict field checking.
func Parse(raw []byte) (*Lab, error) {
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)

	var lab Lab
	if err := dec.Decode(&lab); err != nil {
		return nil, fmt.Errorf("parse lab: %w", err)
	}
	return &lab, nil
}
