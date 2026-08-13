#!/usr/bin/env bash
# Publish kit/ as an OCI artifact to <registry>/<namespace>/simspace-authoring-kit.
#
# The kit is the spec plus its files/ tree — the authoring skills and the agent
# guidance. It is NOT an image; nothing here builds or pushes a container. The
# two Simspace images are built by build-images.yml.
#
# Usage:
#   scripts/publish-kit.sh <tag>
#
#   DRY_RUN=1 scripts/publish-kit.sh v1.0.0            # print the plan, touch nothing
#   MOVE_LATEST=true scripts/publish-kit.sh 20260813-abc123
#
# Environment:
#   REGISTRY      default docker.io
#   NAMESPACE     default dockersamples
#   TAG_LATEST    default latest    — the rolling tag MOVE_LATEST re-points
#   MOVE_LATEST   default false     — also re-point the rolling tag
#   SIGN          set to any value  — pass --sign (needs a prior `sbx login`)
#   DRY_RUN       set to any value  — resolve and report, publish nothing
#
# Emits `ref=`, `digest=`, `pushed=` and `reused=` on stdout, one per line, so CI
# can redirect into $GITHUB_OUTPUT. Everything human goes to stderr, which keeps
# that redirect safe.
#
# Exit codes: 0 published (or dry run) · 1 refused or failed · 2 usage error.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <tag>" >&2
  exit 2
fi

tag=$1

REGISTRY=${REGISTRY:-docker.io}
NAMESPACE=${NAMESPACE:-dockersamples}
TAG_LATEST=${TAG_LATEST:-latest}
MOVE_LATEST=${MOVE_LATEST:-false}
SIGN=${SIGN:-}
DRY_RUN=${DRY_RUN:-}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
KIT_DIR="$REPO_ROOT/kit"

# The KEY=VALUE stream CI redirects into $GITHUB_OUTPUT moves to fd 3, and this
# script's stdout is rerouted to stderr. Structurally, rather than appending
# `>&2` to each command: `sbx kit validate` prints "VALID: …", `sbx kit push`
# prints "Pushed …", and `oras tag` prints too — any one of them lands in
# $GITHUB_OUTPUT as a malformed line and fails the step with "Invalid format".
# Command substitution is unaffected: $(oras manifest fetch …) still captures
# that process's own stdout.
exec 3>&1 1>&2

log() { echo "$@"; }
die() { echo "error: $*"; exit 1; }
emit() { echo "$1=$2" >&3; }

[ -f "$KIT_DIR/spec.yaml" ] || die "no kit/spec.yaml at $KIT_DIR"

# The reference is composed here, never read from the spec or taken as an
# argument. `sbx kit push` uses whatever reference it is handed verbatim — it
# derives nothing from the kit name and validates nothing against it — so a
# wrong value would push a kit manifest over an unrelated tag in this namespace,
# `dockersamples/simspace` itself included.
ref="${REGISTRY}/${NAMESPACE}/simspace-authoring-kit"

log "kit         : ${KIT_DIR}"
log "reference   : ${ref}:${tag}"
log "rolling tag : $([ "$MOVE_LATEST" = "true" ] && echo "${ref}:${TAG_LATEST}" || echo "(not moved)")"
log "signing     : $([ -n "$SIGN" ] && echo "yes" || echo "no")"

summarise() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "## simspace-authoring-kit"
    echo ""
    printf '%s\n' "$1"
  } >> "$GITHUB_STEP_SUMMARY"
}

# Validation runs BEFORE the dry-run exit, deliberately. A pull request is a dry
# run end to end, and validating only on the way to a real push would let a PR
# that breaks the kit report a green publish job — the failure would surface on
# merge instead, which is what this job exists to prevent.
log ""
if command -v sbx >/dev/null; then
  log "==> validating"
  sbx kit validate "$KIT_DIR"
else
  # Someone inspecting the plan locally should not need sbx installed; CI always
  # has it, so this branch never runs there. Loud rather than silent, because the
  # point of the step above is that it is not skippable by accident.
  [ -n "$DRY_RUN" ] || die "sbx is not on PATH — install it from https://github.com/docker/sbx-releases"
  log "!!! sbx not on PATH — SKIPPING validation (dry run only)"
fi

if [ -n "$DRY_RUN" ]; then
  log ""
  log "DRY RUN — nothing is published. Would:"
  log "  1. check ${ref}:${tag} does not already exist"
  log "  2. sbx kit push ${KIT_DIR} ${ref}:${tag}${SIGN:+ --sign}"
  if [ "$MOVE_LATEST" = "true" ]; then
    # Described rather than shown as a command: the digest does not exist until
    # step 2 has run, and the retag addresses the manifest by digest so a racing
    # push cannot swap what `latest` ends up pointing at.
    log "  3. re-point ${ref}:${TAG_LATEST} at the digest step 2 produces"
    log "     (oras tag, by digest — not knowable before the push)"
  fi
  emit ref "$ref"
  emit pushed false
  emit reused false
  summarise "**Dry run — nothing published.** Kit validated. Would have published \`${ref}:${tag}\`."
  exit 0
fi

for bin in oras jq; do
  command -v "$bin" >/dev/null || die "$bin is not on PATH"
done

# Tags are immutable by convention; the registry does not enforce that unless Hub
# tag-immutability is on. What a collision means depends on the caller:
#
#   MOVE_LATEST=false (a release) — a version is being re-cut over a published
#     one. Always an error; the fix is a new version.
#   MOVE_LATEST=true (continuous) — the tag is <date>-<sha>, so a collision just
#     means this commit was already published today, i.e. a re-run. Reuse it: a
#     re-run is the only way back when the push landed and a later step did not,
#     and failing here would strand the rolling tag on the previous artifact.
#
# Probed with oras, not `docker manifest inspect`: a kit is an OCI manifest with
# a custom artifactType and a non-image config, which image-oriented tooling may
# reject outright — and a rejection would be indistinguishable from "absent",
# waving through the overwrite this check exists to prevent.
log ""
log "==> checking whether ${ref}:${tag} already exists"
existing_err=$(mktemp)
trap 'rm -f "$existing_err"' EXIT
reused=false
digest=""

if existing=$(oras manifest fetch --descriptor "${ref}:${tag}" 2>"$existing_err"); then
  digest=$(printf '%s' "$existing" | jq -r .digest)
  if [ "$MOVE_LATEST" = "true" ]; then
    log "    already exists (${digest}) — re-run, reusing it"
    reused=true
  else
    die "${ref}:${tag} already exists (${digest}). Published versions are immutable — cut a new version rather than re-tagging this one."
  fi
else
  # "Not there" and "could not tell" are different answers. Treating an auth or
  # transport failure as absent is how an immutable tag gets overwritten.
  if grep -qiE 'not found|manifest unknown|name unknown|404' "$existing_err"; then
    log "    not published yet"
  else
    log "    could not determine whether it exists:"
    cat "$existing_err"
    exit 1
  fi
fi

if [ "$reused" = "false" ]; then
  log "==> pushing"
  # shellcheck disable=SC2086 # SIGN is a flag or empty, deliberately unquoted
  sbx kit push "$KIT_DIR" "${ref}:${tag}" ${SIGN:+--sign}

  # The push does not echo the digest, and re-reading the tag later would let a
  # racing push swap the manifest we then advertise as the rolling tag.
  digest=$(oras manifest fetch --descriptor "${ref}:${tag}" | jq -r .digest)
  # An `if`, not `[ -n "$d" ] && [ "$d" != null ]`: set -e does not fire when the
  # FIRST test of an && list fails, so that form falls through with an empty
  # digest and blows up later on `oras tag "<ref>@"`.
  if [ -z "$digest" ] || [ "$digest" = "null" ]; then
    die "pushed ${ref}:${tag} but could not read back its digest"
  fi
  log "    pushed ${digest}"
fi

if [ "$MOVE_LATEST" = "true" ]; then
  # Retag by digest rather than pushing a second time. A second push re-packs the
  # kit, and the pack stamps org.opencontainers.image.created, so the second
  # manifest almost always digests differently — and if the pushes are signed,
  # each digest carries its OWN signature, so the two tags would advertise
  # different attestations for one source. "Almost always" is the problem: that
  # annotation has one-second resolution, so two pushes inside the same second
  # produce identical manifests and the divergence silently does not happen.
  #
  # Needs PULL as well as push: the manifest is fetched before being re-PUT.
  log "==> re-pointing ${TAG_LATEST} at ${digest}"
  oras tag "${ref}@${digest}" "${TAG_LATEST}"
fi

emit ref "$ref"
emit digest "$digest"
emit pushed "$([ "$reused" = "true" ] && echo false || echo true)"
emit reused "$reused"

{
  echo "Published \`${digest}\`:"
  echo ""
  echo "- \`${ref}:${tag}\`"
  [ "$MOVE_LATEST" = "true" ] &&
    echo "- \`${ref}:${TAG_LATEST}\` — rolling, re-pointed at the same digest"
  echo ""
  echo "Consume it with:"
  echo ""
  echo '```yaml'
  echo "# .sbxenv.yaml"
  echo "kits:"
  echo "  - ${ref}:${tag}"
  echo '```'
} > /tmp/publish-kit-summary.md
summarise "$(cat /tmp/publish-kit-summary.md)"

log ""
log "done"
