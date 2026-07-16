// Renders mocked MCP tool calls as sbx-style terminal output. No external
// service is ever contacted. Ported from the Go mcp package.
// See sbx-simulator/docs/scenario-spec.md §9.

import { MCPCall, StateValue } from "./types";

/**
 * renderMCP formats one mocked MCP call into output lines. Argument keys are
 * sorted so output is deterministic regardless of map order.
 */
export function renderMCP(call: MCPCall): string[] {
  const lines: string[] = [`→ Calling MCP tool: ${call.tool}`];

  const args = call.arguments ?? {};
  const keys = Object.keys(args).sort();
  if (keys.length > 0) {
    lines.push("  Arguments:");
    for (const k of keys) {
      lines.push(`    ${k}=${formatArg(args[k])}`);
    }
  }

  lines.push("  Result:");
  const result = (call.result ?? "").replace(/\n+$/, "");
  for (const r of result.split("\n")) {
    lines.push("    " + r);
  }
  return lines;
}

function formatArg(v: StateValue): string {
  if (v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
