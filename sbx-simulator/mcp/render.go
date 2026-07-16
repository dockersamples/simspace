// Package mcp renders mocked MCP tool calls as sbx-style terminal output. No
// external service is ever contacted. See docs/scenario-spec.md §9.
package mcp

import (
	"fmt"
	"sort"
	"strings"

	"github.com/dockersamples/sbx-simulator/manifest"
)

// Render formats one mocked MCP call into output lines. Argument keys are
// sorted so output is deterministic regardless of map iteration order.
func Render(call manifest.MCPCall) []string {
	lines := []string{fmt.Sprintf("→ Calling MCP tool: %s", call.Tool)}

	if len(call.Arguments) > 0 {
		lines = append(lines, "  Arguments:")
		keys := make([]string, 0, len(call.Arguments))
		for k := range call.Arguments {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			lines = append(lines, fmt.Sprintf("    %s=%v", k, call.Arguments[k]))
		}
	}

	lines = append(lines, "  Result:")
	for _, r := range strings.Split(strings.TrimRight(call.Result, "\n"), "\n") {
		lines = append(lines, "    "+r)
	}
	return lines
}
