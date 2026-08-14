// Namespacing for localStorage keys so several labs can coexist in one engine
// without clobbering each other's progress, variables, or terminal transcripts.
//
// A lab's key is its catalog id (the directory name under labs/), so every lab —
// including the sole lab of a single-lab repo — keeps its own progress,
// variables, and terminal transcripts.

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
