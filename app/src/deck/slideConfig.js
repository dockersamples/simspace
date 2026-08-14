/** Layouts a slide may name. An unknown value falls back to `default` and is
 * reported by validate-lab, so a typo shows a plain slide rather than nothing. */
export const LAYOUTS = [
  "default",
  "title",
  "section",
  "split",
  "stats",
  "quote",
  "image",
];

/** Surface variants of the Docker theme. */
export const THEMES = ["light", "dark", "tint"];

// What a slide's `config` may say: the layouts and themes it can name, and how
// its `columns:` reads into flex ratios.
//
// Plain data and one pure function, deliberately OUTSIDE the React context that
// consumes them. `scripts/validate-lab.ts` and the unit tests need them too, and
// reaching into DeckContext.jsx for them dragged the whole lab runtime —
// renderer, mermaid, stylesheets — into a Node bundle that can't load any of it.

/**
 * Reads `columns:` into a list of positive weights, or null for equal columns.
 *
 * Accepts `columns: 2 1`, `columns: [2, 1]`, or `columns: "2 1"` — YAML turns
 * the unquoted form into a string or a number depending on how it's written, and
 * an author shouldn't have to care which. A zero, a negative, or a non-number
 * anywhere means the whole value is ignored: a half-applied ratio would be a
 * stranger layout than the equal columns it replaced.
 */
export function parseColumns(raw) {
  if (raw === undefined || raw === null) return null;
  const parts = Array.isArray(raw)
    ? raw
    : String(raw)
        .trim()
        .split(/[\s,:]+/)
        .filter(Boolean);
  if (parts.length < 2) return null;
  const weights = parts.map((p) => Number(p));
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) return null;
  return weights;
}
