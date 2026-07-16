#!/usr/bin/env bash
#
# capture-sbx-samples.sh — capture real `sbx` CLI output on the host.
#
# The SBX Simulator invents its output. To make simulated labs look like the
# real thing, run this on a host that has the *real* `sbx` installed. It runs a
# curated set of commands, captures stdout/stderr/exit-code for each, and writes:
#
#   <outdir>/
#     captures/<slug>.txt   one annotated file per command
#     SAMPLES.md            everything concatenated, ready to hand to an agent
#     INDEX.md              a table of contents (command -> file, exit code)
#
# Feed SAMPLES.md (or the whole dir) to an agent as context when authoring a
# sbx-simulator.yaml so its `output:` blocks match real `sbx` formatting.
#
# By default only SAFE, read-only commands run (help text, version, listings).
# Side-effecting lifecycle commands (create/exec/rm) run only with --lifecycle.
#
# Usage:
#   scripts/capture-sbx-samples.sh [options]
#
# Options:
#   -o, --out DIR      Output directory (default: ./sbx-samples)
#       --bin PATH     Path to the sbx binary (default: first `sbx` on PATH)
#       --no-discover  Don't auto-walk the --help tree; only the curated list
#       --lifecycle    ALSO run a real create/exec/rm cycle (side effects!)
#       --keep-ansi    Keep ANSI color codes (default: strip them)
#       --no-redact    Don't rewrite $HOME to ~ in captured output
#   -h, --help         Show this help
#
# Examples:
#   scripts/capture-sbx-samples.sh                       # safe capture
#   scripts/capture-sbx-samples.sh -o /tmp/sbx-out       # custom dir
#   scripts/capture-sbx-samples.sh --lifecycle           # + real lifecycle
#
set -uo pipefail

# ---- options ---------------------------------------------------------------
OUTDIR="./sbx-samples"
SBX_BIN=""
DISCOVER=1
LIFECYCLE=0
KEEP_ANSI=0
REDACT=1

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out)      OUTDIR="${2:?}"; shift 2 ;;
    --bin)         SBX_BIN="${2:?}"; shift 2 ;;
    --no-discover) DISCOVER=0; shift ;;
    --lifecycle)   LIFECYCLE=1; shift ;;
    --keep-ansi)   KEEP_ANSI=1; shift ;;
    --no-redact)   REDACT=0; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "unknown option: $1 (try --help)" ;;
  esac
done

# ---- locate the real sbx ---------------------------------------------------
[ -n "$SBX_BIN" ] || SBX_BIN="$(command -v sbx 2>/dev/null || true)"
[ -n "$SBX_BIN" ] || die "no 'sbx' on PATH. Install the real CLI or pass --bin."

# Guard against pointing this at the simulator itself.
if "$SBX_BIN" --version 2>&1 | grep -qi 'simulator'; then
  die "'$SBX_BIN' looks like the SBX Simulator, not the real CLI. Pass --bin to the real one."
fi

# Make output stable/non-interactive: no color, no pager, wide, non-tty.
export NO_COLOR=1
export CLICOLOR=0
export TERM=dumb
export PAGER=cat

CAPDIR="$OUTDIR/captures"
mkdir -p "$CAPDIR" || die "cannot create $CAPDIR"
: > "$OUTDIR/SAMPLES.md"
: > "$OUTDIR/INDEX.md"

HOME_ESC="$(printf '%s' "$HOME" | sed 's/[.[\*^$/]/\\&/g')"

strip_or_redact() {
  # stdin -> stdout, optionally stripping ANSI and redacting $HOME.
  local sed_prog=''
  [ "$KEEP_ANSI" -eq 1 ] || sed_prog='s/\x1b\[[0-9;?]*[a-zA-Z]//g;'
  [ "$REDACT" -eq 1 ] && sed_prog="${sed_prog}s#${HOME_ESC}#~#g;"
  if [ -n "$sed_prog" ]; then sed -E "$sed_prog"; else cat; fi
}

slugify() { printf '%s' "$*" | tr ' /' '__' | tr -cd 'A-Za-z0-9_.-'; }

SEEN_FILE="$(mktemp)"
trap 'rm -f "$SEEN_FILE"' EXIT

# capture "<label>" -- <argv...>
# Runs `sbx <argv>` and records the command line, exit code, stdout, stderr.
capture() {
  local label="$1"; shift
  [ "$1" = "--" ] && shift
  local key="$*"
  if grep -qxF "$key" "$SEEN_FILE" 2>/dev/null; then return; fi
  printf '%s\n' "$key" >> "$SEEN_FILE"
  local slug; slug="$(slugify "$label")"
  local file="$CAPDIR/$slug.txt"
  local out err rc
  out="$("$SBX_BIN" "$@" 2>/tmp/sbx_cap_err.$$)"; rc=$?
  err="$(cat /tmp/sbx_cap_err.$$)"; rm -f /tmp/sbx_cap_err.$$

  {
    printf '# $ sbx %s\n' "$*"
    printf '# exit: %s\n' "$rc"
    printf '# ---- stdout ----\n'
    printf '%s\n' "$out" | strip_or_redact
    printf '# ---- stderr ----\n'
    printf '%s\n' "$err" | strip_or_redact
  } > "$file"

  # Combined markdown block.
  {
    printf '## `sbx %s`\n\n' "$*"
    printf 'Exit code: `%s`\n\n' "$rc"
    printf '```console\n$ sbx %s\n' "$*"
    printf '%s\n' "$out" | strip_or_redact
    if [ -n "$err" ]; then
      printf '\n# --- stderr ---\n'
      printf '%s\n' "$err" | strip_or_redact
    fi
    printf '```\n\n'
  } >> "$OUTDIR/SAMPLES.md"

  printf '| `sbx %s` | %s | `captures/%s.txt` |\n' "$*" "$rc" "$slug" >> "$OUTDIR/INDEX.md"
  printf '  captured: sbx %s (exit %s)\n' "$*" "$rc"
}

# discover_subcommands <argv...>
# Prints the immediate subcommand names found in `sbx <argv> --help`.
discover_subcommands() {
  "$SBX_BIN" "$@" --help 2>/dev/null \
    | awk '
        /^[A-Za-z].*Commands:/ { inblk=1; next }
        /^[A-Za-z]/            { inblk=0 }
        inblk && /^[[:space:]]+[a-z]/ {
          gsub(/^[[:space:]]+/, ""); print $1
        }
      ' \
    | grep -Ev '^(help)$' | sort -u
}

# walk_help <argv...>  — capture --help here, then recurse into subcommands.
walk_help() {
  local depth="$1"; shift
  local label="help ${*:-root}"
  capture "$label" -- "$@" --help
  [ "$depth" -le 0 ] && return
  local sub
  while IFS= read -r sub; do
    [ -n "$sub" ] || continue
    walk_help $((depth - 1)) "$@" "$sub"
  done < <(discover_subcommands "$@")
}

printf '# sbx CLI output samples\n\n' >> "$OUTDIR/SAMPLES.md"
printf 'Captured from `%s` on %s.\n\n' "$SBX_BIN" "$(uname -srm)" >> "$OUTDIR/SAMPLES.md"
printf '# sbx sample index\n\n| command | exit | file |\n|---|---|---|\n' >> "$OUTDIR/INDEX.md"

# ---- 1. version + top-level help ------------------------------------------
capture "version" -- --version

# ---- 2. curated help set (works even if discovery finds nothing) ----------
CURATED=(
  ""                       # top-level help
  "run" "exec" "create" "rm" "ls" "setup" "login"
  "kit" "template" "ports" "secret"
  "policy" "policy allow" "policy allow network" "policy log" "policy ls"
)
for c in "${CURATED[@]}"; do
  # shellcheck disable=SC2086
  capture "help ${c:-root}" -- $c --help
done

# ---- 3. auto-discovery (recursive) ----------------------------------------
if [ "$DISCOVER" -eq 1 ]; then
  printf '\n== auto-discovering subcommand tree ==\n'
  walk_help 3
fi

# ---- 4. safe read-only runtime captures -----------------------------------
printf '\n== safe runtime captures ==\n'
capture "ls" -- ls
capture "policy ls" -- policy ls
capture "policy log" -- policy log

# ---- 5. lifecycle (opt-in; real side effects) -----------------------------
if [ "$LIFECYCLE" -eq 1 ]; then
  printf '\n== lifecycle capture (real side effects) ==\n'
  NAME="sbx-sample-$$"
  WS="$(mktemp -d)"
  ( cd "$WS" && git init -q . && echo "hello" > README.md && git add -A && git commit -qm init ) 2>/dev/null
  capture "create" -- create --name "$NAME" --workspace "$WS"
  capture "ls (after create)" -- ls
  capture "exec echo" -- exec "$NAME" -- echo "hello from sandbox"
  capture "ports" -- ports "$NAME"
  capture "rm" -- rm "$NAME"
  capture "ls (after rm)" -- ls
  rm -rf "$WS"
fi

printf '\nDone. Review:\n  %s/SAMPLES.md   (hand this to the agent)\n  %s/INDEX.md\n  %s/captures/*.txt\n' \
  "$OUTDIR" "$OUTDIR" "$OUTDIR"
