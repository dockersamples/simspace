// Package engine selects and applies scenarios. Matching ANDs a scenario's
// command path, argument matchers, exact prompt, and state preconditions;
// scenarios are evaluated in author order and the first full match wins. See
// docs/scenario-spec.md §5–6.
package engine

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/dockersamples/sbx-simulator/commands"
	"github.com/dockersamples/sbx-simulator/manifest"
)

// StateReader is the read side of the state store the matcher needs.
type StateReader interface {
	Get(path string) (any, bool)
}

// MatchResult is the selected scenario plus arguments captured during matching
// (available to templating as {{ args.<name> }}).
type MatchResult struct {
	Scenario *manifest.Scenario
	Args     map[string]string
}

// Match returns the first command scenario whose `when` is fully satisfied, or
// nil if none match. Agent scenarios (when.agent) are never matched here.
func Match(lab *manifest.Lab, cmd commands.Command, st StateReader) *MatchResult {
	for i := range lab.Scenarios {
		sc := &lab.Scenarios[i]
		if sc.When.Agent || sc.When.Shell {
			continue
		}
		if captures, ok := matchWhen(&sc.When, cmd, st); ok {
			return &MatchResult{Scenario: sc, Args: captures}
		}
	}
	return nil
}

// MatchAgent returns the first agent scenario (when.agent) whose prompt and
// state conditions match the given prompt, or nil if none match.
func MatchAgent(lab *manifest.Lab, prompt string, st StateReader) *MatchResult {
	for i := range lab.Scenarios {
		sc := &lab.Scenarios[i]
		if !sc.When.Agent {
			continue
		}
		if matchAgentWhen(&sc.When, prompt, st) {
			return &MatchResult{Scenario: sc}
		}
	}
	return nil
}

// MatchShell returns the first shell scenario (when.shell) whose command text
// and state conditions match the given shell-escape command, or nil if none
// match. command is the text after the `!`; a leading `!` on either side is
// ignored, so a matcher may be written as "cat app/server.js" or
// "!cat app/server.js".
func MatchShell(lab *manifest.Lab, command string, st StateReader) *MatchResult {
	normalized := stripBang(command)
	for i := range lab.Scenarios {
		sc := &lab.Scenarios[i]
		if !sc.When.Shell {
			continue
		}
		if matchShellWhen(&sc.When, normalized, st) {
			return &MatchResult{Scenario: sc}
		}
	}
	return nil
}

// matchShellWhen evaluates a shell scenario against a (bang-stripped) command
// and state.
func matchShellWhen(w *manifest.When, command string, st StateReader) bool {
	if !shellPromptMatches(w, command) {
		return false
	}
	for path, expected := range w.State {
		actual, present := st.Get(path)
		if !stateEqual(expected, actual, present) {
			return false
		}
	}
	return true
}

// shellPromptMatches applies a shell scenario's prompt/promptContains matcher to
// the bang-stripped command text. A scenario with neither matcher is the
// catch-all for any shell command.
func shellPromptMatches(w *manifest.When, command string) bool {
	if w.Prompt != nil {
		return command == stripBang(*w.Prompt)
	}
	if len(w.PromptContains) > 0 {
		lower := strings.ToLower(command)
		for _, kw := range w.PromptContains {
			if !strings.Contains(lower, strings.ToLower(kw)) {
				return false
			}
		}
		return true
	}
	return true
}

// stripBang trims s and removes a single leading "!" shell-escape marker.
func stripBang(s string) string {
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, "!") {
		return strings.TrimSpace(trimmed[1:])
	}
	return trimmed
}

// matchAgentWhen evaluates an agent scenario against a prompt and state.
func matchAgentWhen(w *manifest.When, prompt string, st StateReader) bool {
	if !promptMatches(w, prompt) {
		return false
	}
	for path, expected := range w.State {
		actual, present := st.Get(path)
		if !stateEqual(expected, actual, present) {
			return false
		}
	}
	return true
}

// promptMatches applies a scenario's prompt matcher. A scenario with neither
// `prompt` nor `promptContains` matches any prompt (catch-all).
func promptMatches(w *manifest.When, prompt string) bool {
	trimmed := strings.TrimSpace(prompt)
	if w.Prompt != nil {
		return trimmed == strings.TrimSpace(*w.Prompt)
	}
	if len(w.PromptContains) > 0 {
		lower := strings.ToLower(trimmed)
		for _, kw := range w.PromptContains {
			if !strings.Contains(lower, strings.ToLower(kw)) {
				return false
			}
		}
		return true
	}
	return true
}

// matchWhen evaluates a single scenario's conditions, returning captured args
// on success.
func matchWhen(w *manifest.When, cmd commands.Command, st StateReader) (map[string]string, bool) {
	// 1. Command path must be a prefix of the positional tokens.
	if len(w.Command) > len(cmd.Tokens) {
		return nil, false
	}
	for i, tok := range w.Command {
		if cmd.Tokens[i] != tok {
			return nil, false
		}
	}
	remaining := cmd.Tokens[len(w.Command):]

	// 2. Exact prompt match against the remaining positionals joined.
	if w.Prompt != nil {
		got := strings.TrimSpace(strings.Join(remaining, " "))
		if got != strings.TrimSpace(*w.Prompt) {
			return nil, false
		}
	}

	// 3. Argument matchers.
	captures := map[string]string{}
	for name, m := range w.Args {
		value, present := resolveArg(name, cmd, remaining)
		ok, capture := evalMatcher(m, value, present)
		if !ok {
			return nil, false
		}
		if capture {
			captures[name] = value
		}
	}

	// 4. State preconditions.
	for path, expected := range w.State {
		actual, present := st.Get(path)
		if !stateEqual(expected, actual, present) {
			return nil, false
		}
	}

	return captures, true
}

// resolveArg looks up an argument by name. An integer name indexes the
// positional args remaining after the command path; any other name is a flag.
func resolveArg(name string, cmd commands.Command, remaining []string) (value string, present bool) {
	if idx, err := strconv.Atoi(name); err == nil && idx >= 0 {
		if idx < len(remaining) {
			return remaining[idx], true
		}
		return "", false
	}
	v, ok := cmd.Flags[name]
	return v, ok
}

// evalMatcher applies a matcher to a resolved argument. capture is true when
// the value should be exposed to templating.
func evalMatcher(m manifest.Matcher, value string, present bool) (ok, capture bool) {
	switch m.Kind {
	case manifest.MatchEquals:
		return present && value == m.Value, true
	case manifest.MatchPresent:
		return present, false
	case manifest.MatchAbsent:
		return !present, false
	case manifest.MatchAny:
		return present, true
	case manifest.MatchOneOf:
		if !present {
			return false, false
		}
		for _, cand := range m.OneOf {
			if value == cand {
				return true, true
			}
		}
		return false, false
	default:
		return false, false
	}
}

// stateEqual compares an expected precondition value against the actual state
// value. A missing key is treated as nil, and a zero-valued expectation
// (false, "", 0, nil) matches a missing key — so `running: false` matches both
// an explicit false and an unset key (§6.4).
func stateEqual(expected, actual any, present bool) bool {
	if !present {
		return isZero(expected)
	}
	return jsonEqual(expected, actual)
}

// isZero reports whether v is a zero value for matching purposes.
func isZero(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case bool:
		return !t
	case string:
		return t == ""
	case int:
		return t == 0
	case int64:
		return t == 0
	case float64:
		return t == 0
	default:
		return false
	}
}

// jsonEqual compares two values by their JSON encoding, which normalizes
// numeric types (int vs float64 across the YAML/JSON boundary) while keeping
// type distinctions like false vs "false".
func jsonEqual(a, b any) bool {
	ab, err1 := json.Marshal(a)
	bb, err2 := json.Marshal(b)
	if err1 != nil || err2 != nil {
		return false
	}
	return string(ab) == string(bb)
}
