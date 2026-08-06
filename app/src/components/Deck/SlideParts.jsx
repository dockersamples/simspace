// The slide component vocabulary: `:::stat`, `:::card`, and `:tag[…]`.
//
// Three components rather than the nine archetypes the reference deck's design
// system enumerates, because those nine are the SAME shape wearing different
// paint: an optional label, a body, and an accent colour. Collapsing them into one
// card with variants is what keeps this a bounded feature instead of a design
// system that grows a component every time somebody designs a slide.
//
// Between them they cover every non-code block in `references/screenshots`:
// the stat trio, the agenda rows, the before/after verdict pills, the annotation
// cards beside a code window, and the two big feature panels.

/** Accents available to a card or tag. Anything else falls back to `blue`. */
const ACCENTS = ["blue", "green", "red", "amber", "neutral"];

function accentClass(raw, fallback = "blue") {
  const accent = ACCENTS.includes(raw) ? raw : fallback;
  return `deck-accent-${accent}`;
}

/**
 * A headline statistic: an oversized number with a caption under it.
 *
 *   :::stat{value="20B+"}
 *   Docker Hub pulls per month across every language and stack
 *   :::
 *
 * Pair with `layout: stats` to get them side by side; on any other layout they
 * stack. The value is config rather than content because it's a distinct
 * typographic role, not a heading — and putting it in the body would make the
 * caption's markdown ambiguous.
 */
export function Stat({ node, children }) {
  const { value, label, accent } = node?.properties ?? {};
  return (
    <div className={`deck-stat ${accentClass(accent)}`}>
      {label && <div className="deck-stat-label">{label}</div>}
      <div className="deck-stat-value">{value}</div>
      <div className="deck-stat-desc">{children}</div>
    </div>
  );
}

/**
 * A panel: the workhorse of the component set.
 *
 *   :::card{label="sync action"}
 *   Copies changed files into the running container without rebuilding.
 *   :::
 *
 * | attribute | effect                                                        |
 * | --------- | ------------------------------------------------------------- |
 * | `label`   | small uppercase label above the body                          |
 * | `accent`  | blue (default) · green · red · amber · neutral                 |
 * | `variant` | `rule` (default, accent bar on the left) · `fill` · `outline` |
 *
 * `rule` is the default because it's the lightest of the three — a card should be
 * a slight emphasis, and a slide full of filled boxes reads as a form.
 */
export function Card({ node, children }) {
  const { label, accent, variant } = node?.properties ?? {};
  const kind = ["rule", "fill", "outline"].includes(variant) ? variant : "rule";
  return (
    <div
      className={`deck-card deck-card--${kind} ${accentClass(accent, kind === "fill" ? "neutral" : "blue")}`}
    >
      {label && <div className="deck-card-label">{label}</div>}
      <div className="deck-card-body">{children}</div>
    </div>
  );
}

/**
 * An inline pill, for labelling a column or a code sample:
 *
 *   :tag[Before]{accent=red}
 *   :tag[After]{accent=green}
 *
 * A text directive (single colon), so it can sit inside a paragraph — which is
 * how the before/after slide uses it, immediately above a code block.
 */
export function Tag({ node, children }) {
  const { accent } = node?.properties ?? {};
  return (
    <span className={`deck-tag ${accentClass(accent, "neutral")}`}>
      {children}
    </span>
  );
}
