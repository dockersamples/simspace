package engine

import (
	"fmt"
	"math"
	"regexp"
)

// tmplPattern matches {{ args.name }} / {{ state.dot.path }} placeholders. Only
// simple substitution is supported (no logic or expressions) per §7.4.
var tmplPattern = regexp.MustCompile(`\{\{\s*(args|state)\.([A-Za-z0-9_.]+)\s*\}\}`)

// render substitutes template placeholders in s using captured args and the
// (post-delta) state. Unknown placeholders render as an empty string.
func render(s string, args map[string]string, st StateReader) string {
	return tmplPattern.ReplaceAllStringFunc(s, func(match string) string {
		m := tmplPattern.FindStringSubmatch(match)
		scope, key := m[1], m[2]
		switch scope {
		case "args":
			return args[key]
		case "state":
			if v, ok := st.Get(key); ok {
				return formatValue(v)
			}
			return ""
		default:
			return ""
		}
	})
}

// formatValue renders a state value as it should appear in output. Integral
// floats (from the JSON state store) print without a decimal point.
func formatValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		if t == math.Trunc(t) && !math.IsInf(t, 0) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%g", t)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", t)
	}
}

// renderLines renders each line of a slice.
func renderLines(lines []string, args map[string]string, st StateReader) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = render(l, args, st)
	}
	return out
}
