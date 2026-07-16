// Package validate statically checks a sbx-simulator.yaml without executing
// it: schema and structural errors, file-op and path lints, and a
// conservative unreachable-scenario detector. It powers `sbx --check`. See
// docs/implementation-plan.md §5.
package validate

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
)

// Severity distinguishes hard failures from advisory lints.
type Severity int

const (
	// Error is a defect that would break the lab; `sbx --check` exits non-zero.
	Error Severity = iota
	// Warning is advisory; it does not fail the check.
	Warning
)

func (s Severity) String() string {
	if s == Warning {
		return "warning"
	}
	return "error"
}

// Finding is a single validation result.
type Finding struct {
	Severity Severity
	Where    string // scenario id / location, e.g. "scenarios[2] (run-start)"
	Message  string
}

func (f Finding) String() string {
	if f.Where == "" {
		return fmt.Sprintf("%s: %s", f.Severity, f.Message)
	}
	return fmt.Sprintf("%s: %s: %s", f.Severity, f.Where, f.Message)
}

// Findings is an ordered set of results with convenience predicates.
type Findings []Finding

// HasErrors reports whether any finding is an Error.
func (fs Findings) HasErrors() bool {
	for _, f := range fs {
		if f.Severity == Error {
			return true
		}
	}
	return false
}

// Lab runs all static checks against a parsed manifest.
func Lab(lab *manifest.Lab) Findings {
	var fs Findings
	fs = append(fs, checkTopLevel(lab)...)
	fs = append(fs, checkScenarios(lab)...)
	fs = append(fs, checkReachability(lab)...)
	return fs
}

func checkTopLevel(lab *manifest.Lab) Findings {
	var fs Findings
	if err := manifest.CheckSchemaVersion(lab.Version); err != nil {
		fs = append(fs, Finding{Error, "", err.Error()})
	}
	if lab.Metadata.ID == "" {
		fs = append(fs, Finding{Error, "metadata", "missing `id`"})
	}
	if lab.Metadata.Title == "" {
		fs = append(fs, Finding{Error, "metadata", "missing `title`"})
	}
	if len(lab.Scenarios) == 0 {
		fs = append(fs, Finding{Error, "scenarios", "a lab must define at least one scenario"})
	}
	if lab.Defaults.Unmatched != nil {
		fs = append(fs, checkThen(*lab.Defaults.Unmatched, "defaults.unmatched")...)
	}
	if lab.Defaults.UnmatchedAgent != nil {
		fs = append(fs, checkThen(*lab.Defaults.UnmatchedAgent, "defaults.unmatchedAgent")...)
	}
	return fs
}

func checkScenarios(lab *manifest.Lab) Findings {
	var fs Findings
	seen := map[string]int{}
	for i, sc := range lab.Scenarios {
		where := location(i, sc.ID)
		if sc.ID == "" {
			fs = append(fs, Finding{Error, fmt.Sprintf("scenarios[%d]", i), "missing `id`"})
		} else if prev, dup := seen[sc.ID]; dup {
			fs = append(fs, Finding{Error, where, fmt.Sprintf("duplicate id (also scenarios[%d])", prev)})
		} else {
			seen[sc.ID] = i
		}
		fs = append(fs, checkWhen(sc.When, where)...)
		fs = append(fs, checkThen(sc.Then, where)...)
	}
	return fs
}

// checkWhen validates a scenario's match conditions for conflicts and
// ineffective fields.
func checkWhen(w manifest.When, where string) Findings {
	var fs Findings
	if len(w.Command) > 0 && w.Agent {
		fs = append(fs, Finding{Error, where, "`command` and `agent` are mutually exclusive"})
	}
	if w.Prompt != nil && len(w.PromptContains) > 0 {
		fs = append(fs, Finding{Error, where, "set only one of `prompt` or `promptContains`"})
	}
	// promptContains is only honored for agent scenarios.
	if !w.Agent && len(w.PromptContains) > 0 {
		fs = append(fs, Finding{Warning, where, "`promptContains` is ignored outside an `agent` scenario"})
	}
	// agent scenarios match on the prompt, not args.
	if w.Agent && len(w.Args) > 0 {
		fs = append(fs, Finding{Warning, where, "`args` is ignored by an `agent` scenario"})
	}
	return fs
}

// checkThen validates the file effects of a Then block.
func checkThen(then manifest.Then, where string) Findings {
	var fs Findings
	for j, op := range then.Files {
		opWhere := fmt.Sprintf("%s files[%d]", where, j)
		verbs := op.Verbs()
		switch {
		case len(verbs) == 0:
			fs = append(fs, Finding{Error, opWhere, "file op sets no operation verb"})
			continue
		case len(verbs) > 1:
			names := make([]string, len(verbs))
			for k, v := range verbs {
				names[k] = v.Name
			}
			fs = append(fs, Finding{Error, opWhere, fmt.Sprintf("file op sets multiple verbs: %v", names)})
		}

		verb := verbs[0]
		if err := filesystem.CheckPath(verb.Path); err != nil {
			fs = append(fs, Finding{Error, opWhere, fmt.Sprintf("%s: %v", verb.Name, err)})
		}
		fs = append(fs, checkOpFields(op, verb, opWhere)...)
	}
	return fs
}

// checkOpFields verifies each verb has its required companion fields and warns
// about companion fields that the verb ignores.
func checkOpFields(op manifest.FileOp, verb manifest.OpVerb, where string) Findings {
	var fs Findings
	switch verb.Name {
	case "replace":
		if op.Find == "" {
			fs = append(fs, Finding{Error, where, "`replace` requires a non-empty `find`"})
		}
		fs = append(fs, warnUnexpected(op, where, "find", "with", "replace")...)
	case "copy":
		if op.To == "" {
			fs = append(fs, Finding{Error, where, "`copy` requires a `to` destination"})
		} else if err := filesystem.CheckPath(op.To); err != nil {
			fs = append(fs, Finding{Error, where, fmt.Sprintf("copy `to`: %v", err)})
		}
		fs = append(fs, warnUnexpected(op, where, "to", "copy")...)
	case "create", "append":
		fs = append(fs, warnUnexpected(op, where, "content", verb.Name)...)
	case "mkdir", "delete":
		fs = append(fs, warnUnexpected(op, where, verb.Name)...)
	}
	return fs
}

// warnUnexpected warns about companion fields set on an op that does not use
// them. allowed lists the companion field names this verb consumes; the final
// element is the verb name (for the message) and is not treated as a field.
func warnUnexpected(op manifest.FileOp, where string, allowed ...string) Findings {
	verb := allowed[len(allowed)-1]
	allow := map[string]bool{}
	for _, a := range allowed[:len(allowed)-1] {
		allow[a] = true
	}
	present := map[string]string{
		"content": op.Content,
		"find":    op.Find,
		"with":    op.With,
		"to":      op.To,
	}
	var fs Findings
	for _, name := range []string{"content", "find", "with", "to"} {
		if present[name] != "" && !allow[name] {
			fs = append(fs, Finding{Warning, where, fmt.Sprintf("`%s` is ignored by `%s`", name, verb)})
		}
	}
	return fs
}

// checkReachability flags scenarios that can never match because an earlier
// scenario always matches first. The analysis is conservative: it reports a
// scenario only when it can prove the earlier one covers every command the
// later one would match, so it never produces false positives (it may miss
// some genuinely unreachable scenarios).
func checkReachability(lab *manifest.Lab) Findings {
	var fs Findings
	for i := range lab.Scenarios {
		later := &lab.Scenarios[i]
		for j := 0; j < i; j++ {
			earlier := &lab.Scenarios[j]
			if covers(&earlier.When, &later.When) {
				fs = append(fs, Finding{
					Warning,
					location(i, later.ID),
					fmt.Sprintf("unreachable: always shadowed by earlier %s", location(j, earlier.ID)),
				})
				break
			}
		}
	}
	return fs
}

// covers reports whether every input matching `spec` also matches `general` —
// i.e. general is at least as permissive as spec, so an earlier general
// scenario shadows a later spec one. Conservative: any uncertainty yields false
// (no warning). Command and agent scenarios never shadow each other.
func covers(general, spec *manifest.When) bool {
	if general.Agent != spec.Agent {
		return false
	}
	if general.Agent {
		return promptCovers(general, spec) && stateCovers(general, spec)
	}
	return coversCommand(general, spec)
}

// promptCovers reports whether general's prompt matcher accepts every prompt
// that spec's matcher accepts.
func promptCovers(general, spec *manifest.When) bool {
	// No prompt constraint => catch-all, accepts everything.
	if general.Prompt == nil && len(general.PromptContains) == 0 {
		return true
	}
	if general.Prompt != nil {
		// Exact general is covered only by the identical exact spec.
		return spec.Prompt != nil && *spec.Prompt == *general.Prompt
	}
	// general.PromptContains is non-empty.
	if spec.Prompt != nil {
		// Spec is a fixed string: general covers it iff that string contains
		// every general keyword.
		lower := strings.ToLower(strings.TrimSpace(*spec.Prompt))
		for _, kw := range general.PromptContains {
			if !strings.Contains(lower, strings.ToLower(kw)) {
				return false
			}
		}
		return true
	}
	if len(spec.PromptContains) > 0 {
		// Spec requires a superset of general's keywords => spec is stricter.
		for _, gk := range general.PromptContains {
			found := false
			for _, sk := range spec.PromptContains {
				if strings.EqualFold(gk, sk) {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
		return true
	}
	return false
}

// stateCovers reports whether general's state preconditions are all guaranteed
// by spec's (spec is at least as constrained).
func stateCovers(general, spec *manifest.When) bool {
	for path, gv := range general.State {
		sv, ok := spec.State[path]
		if !ok || !valueEqual(gv, sv) {
			return false
		}
	}
	return true
}

// coversCommand is the command-scenario case of covers.
func coversCommand(general, spec *manifest.When) bool {
	// Command: general's path must be a prefix of spec's.
	if len(general.Command) > len(spec.Command) {
		return false
	}
	for k, tok := range general.Command {
		if spec.Command[k] != tok {
			return false
		}
	}
	sameLen := len(general.Command) == len(spec.Command)

	// Prompt / positional args reference tokens after the command path, so
	// they are only comparable when the command paths have equal length.
	if general.Prompt != nil {
		if !sameLen || spec.Prompt == nil || *spec.Prompt != *general.Prompt {
			return false
		}
	}

	for name, gm := range general.Args {
		if isIndex(name) && !sameLen {
			return false
		}
		sm, ok := spec.Args[name]
		if !ok || !matcherImplied(gm, sm) {
			return false
		}
	}

	return stateCovers(general, spec)
}

// matcherImplied reports whether a command satisfying spec matcher s always
// satisfies general matcher g. Conservative.
func matcherImplied(g, s manifest.Matcher) bool {
	if g.Kind == s.Kind && g.Value == s.Value && equalStrings(g.OneOf, s.OneOf) {
		return true
	}
	// A guaranteed-present spec implies general "present"/"any".
	guaranteesPresent := s.Kind == manifest.MatchPresent ||
		s.Kind == manifest.MatchAny ||
		s.Kind == manifest.MatchEquals ||
		s.Kind == manifest.MatchOneOf
	switch g.Kind {
	case manifest.MatchPresent, manifest.MatchAny:
		return guaranteesPresent
	default:
		return false
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// valueEqual compares two state values by JSON encoding (numeric-safe, keeps
// type distinctions), matching the engine's matching semantics.
func valueEqual(a, b any) bool {
	ab, err1 := json.Marshal(a)
	bb, err2 := json.Marshal(b)
	return err1 == nil && err2 == nil && string(ab) == string(bb)
}

func isIndex(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func location(i int, id string) string {
	if id == "" {
		return fmt.Sprintf("scenarios[%d]", i)
	}
	return fmt.Sprintf("scenarios[%d] (%s)", i, id)
}

// Sort orders findings errors-first, then by location, for stable output.
func (fs Findings) Sort() {
	sort.SliceStable(fs, func(i, j int) bool {
		if fs[i].Severity != fs[j].Severity {
			return fs[i].Severity < fs[j].Severity
		}
		return fs[i].Where < fs[j].Where
	})
}
