package engine

import (
	"github.com/dockersamples/sbx-simulator/commands"
	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
)

// Result is the outcome of running one command against a lab.
type Result struct {
	Stdout  []string
	Stderr  []string
	Exit    int
	Matched string // scenario ID, or "" if the unmatched default was used
	// Session is set when the matched command scenario declares a session
	// effect; the CLI enters an interactive agent REPL after this result.
	Session *manifest.Session
}

// Run executes one parsed command: it matches a scenario, applies its effects
// (or the unmatched default), records the command in history, and returns the
// output/exit. State mutations are applied to st; callers persist st afterward.
func Run(lab *manifest.Lab, cmd commands.Command, fs *filesystem.FS, st State) (*Result, error) {
	st.Append("history", cmd.Line)

	match := Match(lab, cmd, st)

	var (
		then *manifest.Then
		args map[string]string
		id   string
	)
	if match != nil {
		then = &match.Scenario.Then
		args = match.Args
		id = match.Scenario.ID
	} else {
		then = unmatchedThen(lab)
	}

	stdout, stderr, err := applyThen(then, fs, st, args)
	if err != nil {
		return nil, err
	}

	return &Result{
		Stdout:  stdout,
		Stderr:  stderr,
		Exit:    resolveExit(then, lab, match != nil),
		Matched: id,
		Session: then.Session,
	}, nil
}

// RunAgent dispatches a single agent prompt: it matches an agent scenario (or
// falls back to defaults.unmatchedAgent), applies its effects, records the
// prompt in history, and returns the output. Used for both REPL turns and
// one-shot (`sbx run -p`).
func RunAgent(lab *manifest.Lab, prompt string, fs *filesystem.FS, st State) (*Result, error) {
	st.Append("history", "agent> "+prompt)

	match := MatchAgent(lab, prompt, st)

	var (
		then *manifest.Then
		id   string
	)
	if match != nil {
		then = &match.Scenario.Then
		id = match.Scenario.ID
	} else {
		then = unmatchedAgentThen(lab)
	}

	stdout, stderr, err := applyThen(then, fs, st, nil)
	if err != nil {
		return nil, err
	}

	return &Result{
		Stdout:  stdout,
		Stderr:  stderr,
		Exit:    resolveExit(then, lab, match != nil),
		Matched: id,
	}, nil
}

// unmatchedAgentThen returns the effects for a prompt that matched no agent
// scenario, falling back to a generic line (exit 0 so a session continues).
func unmatchedAgentThen(lab *manifest.Lab) *manifest.Then {
	if lab.Defaults.UnmatchedAgent != nil {
		return lab.Defaults.UnmatchedAgent
	}
	return &manifest.Then{
		Output: []string{"Agent: I'm not sure how to help with that in this lab."},
	}
}

// unmatchedThen returns the effects for a command that matched no scenario,
// falling back to a generic error if the lab defines no default.
func unmatchedThen(lab *manifest.Lab) *manifest.Then {
	if lab.Defaults.Unmatched != nil {
		return lab.Defaults.Unmatched
	}
	exit := 1
	return &manifest.Then{
		Stderr: []string{"Error: unknown or unexpected command in this lab."},
		Exit:   &exit,
	}
}

// resolveExit picks the exit code: the scenario's own Exit, else the lab's
// default Exit, else 0.
func resolveExit(then *manifest.Then, lab *manifest.Lab, _ bool) int {
	if then.Exit != nil {
		return *then.Exit
	}
	if lab.Defaults.Exit != nil {
		return *lab.Defaults.Exit
	}
	return 0
}
