package engine

import (
	"fmt"
	"sort"
	"strings"

	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
	"github.com/dockersamples/sbx-simulator/mcp"
)

// State is the read/write state interface the engine needs (satisfied by
// *state.Store).
type State interface {
	StateReader
	Set(path string, value any)
	Append(path string, value any)
}

// appendSuffix marks a state delta key as a list append (§7.2).
const appendSuffix = "+="

// applyThen applies a scenario's effects in the fixed order files -> state ->
// output/stderr -> mcp, and returns the collected stdout/stderr lines. Exit is
// left to the caller (which layers in defaults).
func applyThen(then *manifest.Then, fs *filesystem.FS, st State, args map[string]string) (stdout, stderr []string, err error) {
	// 1. Files (before state, so file content sees captured args).
	for _, op := range then.Files {
		if err := applyFileOp(op, fs, st, args); err != nil {
			return nil, nil, err
		}
	}

	// 2. State deltas (sorted for deterministic application; string values are
	// templated against args + state applied so far).
	for _, key := range sortedKeys(then.State) {
		raw := then.State[key]
		value := renderStateValue(raw, args, st)
		if path, ok := strings.CutSuffix(key, appendSuffix); ok {
			st.Append(strings.TrimSpace(path), value)
		} else {
			st.Set(key, value)
		}
	}

	// 3. Output / stderr (rendered against args + post-delta state).
	stdout = renderLines(then.Output, args, st)
	stderr = renderLines(then.Stderr, args, st)

	// 4. MCP output appended to stdout.
	for _, call := range then.MCP {
		stdout = append(stdout, mcp.Render(call)...)
	}

	return stdout, stderr, nil
}

// applyFileOp dispatches a single file operation. Exactly one verb must be set.
func applyFileOp(op manifest.FileOp, fs *filesystem.FS, st State, args map[string]string) error {
	content := render(op.Content, args, st)
	with := render(op.With, args, st)

	switch {
	case op.Mkdir != "":
		return fs.Mkdir(op.Mkdir)
	case op.Create != "":
		return fs.Create(op.Create, content)
	case op.Append != "":
		return fs.Append(op.Append, content)
	case op.Replace != "":
		return fs.Replace(op.Replace, op.Find, with)
	case op.Delete != "":
		return fs.Delete(op.Delete)
	case op.Copy != "":
		return fs.Copy(op.Copy, op.To)
	default:
		return fmt.Errorf("file op has no recognized verb")
	}
}

// renderStateValue templates string state values; other types pass through.
func renderStateValue(v any, args map[string]string, st StateReader) any {
	if s, ok := v.(string); ok {
		return render(s, args, st)
	}
	return v
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
