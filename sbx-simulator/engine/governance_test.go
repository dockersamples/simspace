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

// TestGovernanceMCPGolden drives the Governance & MCP lab through the guided
// arc: an agent run is blocked by each policy gate in turn (approval, MCP,
// network), and finally succeeds — rendering the mocked MCP call and writing a
// findings file. It guards state-gated ordering and MCP rendering end to end.
func TestGovernanceMCPGolden(t *testing.T) {
	lab, err := manifest.Load(filepath.Join("..", "testdata", "labs", "governance-mcp", "sbx-simulator.yaml"))
	if err != nil {
		t.Fatalf("load lab: %v", err)
	}

	root := t.TempDir()
	home := filepath.Join(root, ".sbx-sim")
	fs, err := filesystem.New(root)
	if err != nil {
		t.Fatalf("fs: %v", err)
	}

	const prompt = "Find Docker Sandbox repositories"
	steps := []step{
		{args: []string{"agent", "run", prompt},
			wantStderr: []string{
				"Error: running an agent requires organization approval.",
				"Grant it with: sbx policy approve agent",
			},
			wantExit: 1, wantID: "agent-needs-approval"},

		{args: []string{"policy", "approve", "agent"},
			wantStdout: []string{"Approval granted. Agents may now run in this sandbox."},
			wantID:     "approve-agent"},

		{args: []string{"agent", "run", prompt},
			wantStdout: []string{"Agent: I need to search GitHub for that."},
			wantStderr: []string{
				"Blocked: MCP tool 'github.search' is not permitted (no MCP server enabled).",
				"Enable one with: sbx policy allow mcp github",
			},
			wantExit: 1, wantID: "agent-mcp-blocked"},

		{args: []string{"policy", "allow", "mcp", "github"},
			wantStdout: []string{"MCP server 'github' enabled for this sandbox."},
			wantID:     "allow-mcp-github"},

		{args: []string{"agent", "run", prompt},
			wantStdout: []string{"Agent: Calling the github MCP server..."},
			wantStderr: []string{
				"Blocked: network egress to 'api.github.com' denied by policy.",
				"Allow it with: sbx policy allow network api.github.com",
			},
			wantExit: 1, wantID: "agent-network-blocked"},

		{args: []string{"policy", "allow", "network", "api.github.com"},
			wantStdout: []string{"Network egress to 'api.github.com' allowed."},
			wantID:     "allow-network"},
	}

	for i, s := range steps {
		runStep(t, i, lab, fs, home, s)
	}

	// Final step: the successful agent run renders the MCP call and writes a file.
	st, err := state.Load(home, lab.State)
	if err != nil {
		t.Fatalf("load state: %v", err)
	}
	res, err := Run(lab, commands.Parse([]string{"agent", "run", prompt}), fs, st)
	if err != nil {
		t.Fatalf("success run: %v", err)
	}
	if err := st.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}
	if res.Matched != "agent-success" {
		t.Fatalf("final matched = %q; want agent-success", res.Matched)
	}
	if res.Exit != 0 {
		t.Errorf("final exit = %d; want 0", res.Exit)
	}
	stdout := strings.Join(res.Stdout, "\n")
	for _, want := range []string{
		"Agent: Searching GitHub for Docker Sandbox repositories...",
		"→ Calling MCP tool: github.search",
		"    query=docker sandbox",
		"dockersamples/sandbox-demo",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("final stdout missing %q; got:\n%s", want, stdout)
		}
	}

	raw, err := os.ReadFile(filepath.Join(root, "findings", "repositories.md"))
	if err != nil {
		t.Fatalf("read findings: %v", err)
	}
	if !strings.Contains(string(raw), "docker/sandbox-cli") {
		t.Errorf("findings file content = %q", string(raw))
	}
	if v, _ := st.Get("phase"); v != "done" {
		t.Errorf("final phase = %v; want done", v)
	}
}

// runStep drives one command with a freshly reloaded state store and asserts
// its output/exit/matched scenario.
func runStep(t *testing.T, i int, lab *manifest.Lab, fs *filesystem.FS, home string, s step) {
	t.Helper()
	st, err := state.Load(home, lab.State)
	if err != nil {
		t.Fatalf("step %d load: %v", i, err)
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
