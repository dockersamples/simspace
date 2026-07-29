// Namespacing for localStorage keys so several labs can coexist in one engine
// without clobbering each other's progress, variables, or terminal transcripts.
//
// A lab's key is derived from its catalog id (multi-lab mode) or a slug of the
// `?lab=` path (power-user override). The default single lab uses an EMPTY key,
// which leaves the original un-suffixed keys untouched — so existing learners'
// saved state survives the upgrade to a multi-lab-capable build.

/**
 * Suffixes a base localStorage key with a lab key. An empty/falsy labKey
 * returns the base unchanged (backward-compatible single-lab behavior).
 *
 *   scopedKey("simspace:engine", "")            -> "simspace:engine"
 *   scopedKey("simspace:engine", "docker-tour") -> "simspace:engine:docker-tour"
 */
export function scopedKey(base, labKey) {
  return labKey ? `${base}:${labKey}` : base;
}
