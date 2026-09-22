import { LAYOUTS, THEMES, parseColumns } from "./slideConfig";
import { substituteVariables } from "@dockersamples/simspace-labspace";

// The presentation rules for a single slide: layout, theme, columns, image,
// and chrome, plus its variable-substituted content. Pulled out of
// DeckContext so the export view can compute the SAME thing for every slide
// in the deck at once, rather than only for "the current one" — the one
// slide DeckContext's router-driven position was built to track.

/**
 * Derives everything a slide needs to render, from its raw config plus the
 * deck's own defaults.
 */
export function deriveSlidePresentation(slide, { workshop, variables }) {
  const vars = variables || {};

  const regions = (slide?.regions ?? []).map((region) =>
    substituteVariables(region, vars),
  );

  // Presentation config: the slide's own settings layered over the deck's
  // defaults, so an author sets the brand once in labspace.yaml and overrides
  // per slide only where a slide differs.
  const rawLayout = slide?.config?.layout;
  const layout = LAYOUTS.includes(rawLayout) ? rawLayout : "default";

  // `columns: 1 2` weights a split's columns instead of sharing the width
  // equally. Real decks are full of asymmetric pairs — a narrow label column
  // against a wide description — and forcing them to 1:1 rewrites the design.
  const columns = parseColumns(slide?.config?.columns);

  // A full-bleed image for `layout: image`, resolved like every other slide
  // asset so `image: assets/x.png` sits next to the chapter file. `alt:` is a
  // sibling key rather than part of the path because this image is content —
  // a deck read on a screen reader or exported to a printed handout still owes
  // the reader a description of it.
  const image = (() => {
    const src = resolveAsset(slide?.config?.image, slide?.baseUrl);
    if (!src) return null;
    return { src, alt: slide?.config?.alt ?? "" };
  })();

  // Precedence: the slide's own theme, then `image` (always dark), then an
  // EXPLICIT deck theme, then the layout's default, then light.
  //
  // The deck's own `theme:` outranks the layout default, and that is a deliberate
  // reversal of the rule this used to carry. The old order let the layout win, so
  // a deck-wide `theme: light` still produced a dark opener and a tinted divider
  // — three surfaces in a deck that asked for one. That is a fine default for a
  // deck shown on a screen you control, and the wrong one for a conference
  // projector of unknown gamma, where the safe play is to put the whole deck on
  // the surface you tested. A deck that says `theme: light` now gets light
  // throughout, which is also what the reference template's light pages show.
  //
  // A deck that names no theme is unchanged: the layout defaults below still
  // apply, so existing decks keep their dark openers and tinted dividers.
  // Per-slide `theme:` still wins over everything, so an author who wants one
  // dark opener in a light deck says so on that slide, where it is visible.
  //
  // `image` is the exception that stays ahead of the deck default: its overlay is
  // a scrim over an arbitrary photograph, and light-on-dark is the only
  // combination that reliably stays readable there. A slide can still override it.
  const theme = (() => {
    const fromSlide = slide?.config?.theme;
    if (THEMES.includes(fromSlide)) return fromSlide;
    if (layout === "image") return "dark";
    if (THEMES.includes(workshop.theme)) return workshop.theme;
    if (layout === "title") return "dark";
    if (layout === "section") return "tint";
    return "light";
  })();

  // Chrome text. An explicit empty string suppresses a band the deck default
  // would otherwise supply, which is why this checks for undefined rather than
  // falsiness.
  const chrome = (() => {
    const config = slide?.config ?? {};
    const brand = workshop.brand ?? {};
    const pick = (key) =>
      config[key] !== undefined ? config[key] : brand[key];
    return {
      eyebrow: pick("eyebrow") ?? "",
      source: pick("source") ?? "",
      byline: config.byline ?? "",
      // Overridable per slide because a dark surface needs the reversed mark —
      // the one piece of brand that legitimately varies slide to slide. A slide's
      // own value is lab-relative (the loader already resolved `brand.logo`), so
      // resolve it here against the slide's directory.
      logo: resolveAsset(pick("logo"), slide?.baseUrl) ?? null,
      showChrome: config.chrome !== false && brand.chrome !== false,
    };
  })();

  return { regions, layout, columns, image, theme, chrome };
}

/**
 * Resolves a slide-relative asset path against the slide's directory, so a config
 * value like `logo: assets/docker-logo-white.svg` behaves like every other path in
 * a lab. Absolute paths, full URLs, and already-resolved values pass through.
 */
export function resolveAsset(path, baseUrl) {
  if (!path || typeof path !== "string") return path;
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith("/")) return path;
  if (!baseUrl) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

/**
 * Counts the `:::fragment` containers in a slide's markdown. Cheap string scan
 * rather than an AST walk: this runs on every slide change and the directive is
 * unambiguous at the start of a line.
 */
export function countFragments(markdown) {
  const matches = (markdown || "").match(/^\s*:::fragment\b/gm);
  return matches ? matches.length : 0;
}
