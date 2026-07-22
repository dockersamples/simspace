#!/usr/bin/env sh
# PostToolUse hook: after an edit to a file under lab/, validate the lab and, if
# it's broken, feed the errors back to the agent (exit 2). Defensive by design —
# it silently skips when the edit isn't a lab file or when Docker isn't around,
# so it never gets in the way. Delete the `hooks` block in .claude/settings.json
# to turn it off.
#
# Claude Code passes the tool call as JSON on stdin; we only need file_path.

input="$(cat)"

# Extract "file_path":"..." without requiring jq.
path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

# Only act on edits inside the lab/ directory.
case "$path" in
  */lab/* | lab/*) ;;
  *) exit 0 ;;
esac

# Nothing to run against without Docker — skip rather than error.
command -v docker >/dev/null 2>&1 || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if ! output="$(docker compose run --rm validate 2>&1)"; then
  printf '%s\n' "$output" >&2
  echo "" >&2
  echo "Lab validation failed after editing $path — fix the issues above before finishing." >&2
  exit 2
fi

exit 0
