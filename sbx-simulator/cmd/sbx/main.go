// Command sbx is the SBX Simulator: a deterministic, filesystem-backed drop-in
// replacement for the Docker Sandboxes CLI, used in Labspaces labs. It resolves
// a sbx-simulator.yaml, loads persisted state, runs one command through the
// scenario engine, prints realistic output, and persists the new state.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/dockersamples/sbx-simulator/commands"
	"github.com/dockersamples/sbx-simulator/engine"
	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
	"github.com/dockersamples/sbx-simulator/session"
	"github.com/dockersamples/sbx-simulator/state"
	"github.com/dockersamples/sbx-simulator/validate"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executes one invocation and returns the process exit code. It is
// separated from main so tests can drive it with explicit args/writers.
func run(args []string, stdout, stderr *os.File) int {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		fmt.Fprintf(stdout, "sbx simulator %s\n", version)
		return 0
	}

	if len(args) >= 1 && args[0] == "--check" {
		return check(args[1:], stdout, stderr)
	}

	// `sbx sim ...` are simulator meta-commands, not lab scenarios.
	if len(args) >= 1 && args[0] == "sim" {
		return sim(args[1:], stdout, stderr)
	}

	labPath, err := findLab()
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}
	labRoot := filepath.Dir(labPath)

	lab, err := manifest.Load(labPath)
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}
	if err := manifest.CheckSchemaVersion(lab.Version); err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	home := simHome(labRoot)

	st, err := state.Load(home, lab.State)
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	fs, err := filesystem.New(labRoot)
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	cmd := commands.Parse(args)
	result, err := engine.Run(lab, cmd, fs, st)
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	opts := streamOptions(lab.Settings)
	session.WriteLines(stdout, result.Stdout, opts)
	session.WriteLines(stderr, result.Stderr, opts)

	if err := st.Save(); err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	// A scenario may drop the learner into an interactive agent session.
	if result.Session != nil {
		if prompt, ok := oneShotPrompt(cmd); ok {
			exit, serr := session.Once(lab, prompt, fs, st, stdout, stderr, opts)
			if serr != nil {
				fmt.Fprintln(stderr, "sbx:", serr)
				return 1
			}
			return exit
		}
		if serr := session.Run(lab, result.Session, fs, st, os.Stdin, stdout, stderr, opts); serr != nil {
			fmt.Fprintln(stderr, "sbx:", serr)
			return 1
		}
		return 0
	}

	return result.Exit
}

// oneShotPrompt returns the prompt supplied via -p/--prompt for non-interactive
// agent execution, if present.
func oneShotPrompt(cmd commands.Command) (string, bool) {
	if v, ok := cmd.Flags["p"]; ok {
		return v, true
	}
	if v, ok := cmd.Flags["prompt"]; ok {
		return v, true
	}
	return "", false
}

// streamOptions derives output pacing from the lab settings, honoring the
// SBX_SIM_STREAM=0 override used by tests and CI.
func streamOptions(s manifest.Settings) session.Options {
	stream := s.StreamingEnabled()
	if os.Getenv("SBX_SIM_STREAM") == "0" {
		stream = false
	}
	return session.Options{
		Stream: stream,
		Delay:  time.Duration(s.DelayMs()) * time.Millisecond,
		Think:  time.Duration(s.ThinkMs()) * time.Millisecond,
	}
}

// sim dispatches `sbx sim <command>` — simulator-only meta-commands that
// control the simulator itself rather than matching a lab scenario. Namespacing
// them under `sim` keeps the top-level command surface a faithful drop-in for
// the real CLI.
func sim(args []string, stdout, stderr *os.File) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "sbx: usage: sbx sim <command>")
		fmt.Fprintln(stderr, "\nCommands:")
		fmt.Fprintln(stderr, "  reset   Reset simulator state (start the lab over)")
		return 1
	}
	switch args[0] {
	case "reset":
		return simReset(args[1:], stdout, stderr)
	default:
		fmt.Fprintf(stderr, "sbx: unknown sim command %q\n", args[0])
		return 1
	}
}

// simReset clears persisted simulator state by removing the state home
// directory, so the next command re-seeds from the manifest's `state:` block.
func simReset(args []string, stdout, stderr *os.File) int {
	if len(args) > 0 {
		fmt.Fprintln(stderr, "sbx: usage: sbx sim reset")
		return 1
	}

	home, err := resolveHome()
	if err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}

	if _, err := os.Stat(home); os.IsNotExist(err) {
		fmt.Fprintln(stdout, "Simulator state is already clear.")
		return 0
	}
	if err := os.RemoveAll(home); err != nil {
		fmt.Fprintln(stderr, "sbx:", err)
		return 1
	}
	fmt.Fprintln(stdout, "Simulator state reset. The lab will start fresh on the next command.")
	return 0
}

// resolveHome returns the state home directory without requiring a lab to load:
// $SBX_SIM_HOME if set, else <lab-root>/.sbx-sim discovered from $PWD.
func resolveHome() (string, error) {
	if home := os.Getenv("SBX_SIM_HOME"); home != "" {
		return home, nil
	}
	labPath, err := findLab()
	if err != nil {
		return "", err
	}
	return simHome(filepath.Dir(labPath)), nil
}

// simHome returns the state home directory for a known lab root: $SBX_SIM_HOME
// if set, else <lab-root>/.sbx-sim.
func simHome(labRoot string) string {
	if home := os.Getenv("SBX_SIM_HOME"); home != "" {
		return home
	}
	return filepath.Join(labRoot, ".sbx-sim")
}

// check statically validates a sbx-simulator.yaml (path optional; discovered if
// omitted) and prints findings. It returns 0 when there are no errors, 1
// otherwise, so it is usable in CI and authoring loops.
func check(args []string, stdout, stderr *os.File) int {
	var labPath string
	switch len(args) {
	case 0:
		p, err := findLab()
		if err != nil {
			fmt.Fprintln(stderr, "sbx:", err)
			return 1
		}
		labPath = p
	case 1:
		labPath = args[0]
	default:
		fmt.Fprintln(stderr, "sbx: usage: sbx --check [sbx-simulator.yaml]")
		return 1
	}

	lab, err := manifest.Load(labPath)
	if err != nil {
		// A parse/schema error is itself a validation failure.
		fmt.Fprintf(stderr, "error: %v\n", err)
		fmt.Fprintf(stdout, "%s: FAILED (1 error)\n", labPath)
		return 1
	}

	findings := validate.Lab(lab)
	findings.Sort()

	var errs, warns int
	for _, f := range findings {
		if f.Severity == validate.Error {
			errs++
		} else {
			warns++
		}
		fmt.Fprintln(stderr, f)
	}

	if errs > 0 {
		fmt.Fprintf(stdout, "%s: FAILED (%d error(s), %d warning(s))\n", labPath, errs, warns)
		return 1
	}
	fmt.Fprintf(stdout, "%s: OK (%d warning(s))\n", labPath, warns)
	return 0
}

// findLab locates sbx-simulator.yaml via $SBX_SIM_LAB, else by searching
// upward from the working directory.
func findLab() (string, error) {
	if p := os.Getenv("SBX_SIM_LAB"); p != "" {
		return p, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		cand := filepath.Join(dir, "sbx-simulator.yaml")
		if _, err := os.Stat(cand); err == nil {
			return cand, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no sbx-simulator.yaml found in %q or any parent directory", dir)
		}
		dir = parent
	}
}
