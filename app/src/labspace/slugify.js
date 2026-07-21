// Ports slugify + substituteVariables from the Go
// interface/api/internal/labspace/labspace.go so the client can generate the
// same section/service ids and render markdown with variable substitution
// entirely in the browser.

// Everything except lowercase letters, digits, whitespace and dashes.
const SLUG_STRIP = /[^a-z0-9\s-]/g;
// Runs of whitespace collapse to a single dash.
const SLUG_SPACES = /\s+/g;
// A $$variable$$ reference.
const VAR_REF = /\$\$([^$]+)\$\$/g;

/** Converts a title into an id, matching the Go/JS slug generation. */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(SLUG_STRIP, "")
    .replace(SLUG_SPACES, "-");
}

/**
 * Replaces $$name$$ references with their variable value, leaving the bare name
 * in place when the variable is unset or null, then unescapes \$\$ sequences to
 * literal $$. Mirrors substituteVariables in labspace.go.
 */
export function substituteVariables(content, variables = {}) {
  const substituted = String(content ?? "").replace(VAR_REF, (_match, name) => {
    const key = name.trim();
    const val = variables[key];
    if (val !== undefined && val !== null) return String(val);
    return key;
  });
  return substituted.replaceAll("\\$\\$", "$$$$");
}
