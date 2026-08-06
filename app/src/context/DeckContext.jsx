import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router";
import { useWorkshop, useVariables } from "../WorkshopContext";
import { substituteVariables } from "../labspace/slugify";

// Owns "where are we in the deck": the flattened slide list, the current index,
// fragment state, and navigation.
//
// The ROUTER IS THE SINGLE SOURCE OF TRUTH for position — the URL segment is the
// slide id, exactly as a lab's URL segment is its section id. Everything derives
// from that one value, so the back button, a reload, and a pasted link all behave
// without a second copy of "current slide" to keep in sync. (This is the conflict
// that makes reveal.js awkward to embed here: it wants to own the hash too.)
//
// Fragments are the one piece of position NOT in the URL. A fragment is a
// presentation beat within a slide, not a place — putting it in the URL would
// litter history with entries nobody wants to walk back through.

const DeckContext = createContext(null);

/** Layouts a slide may name. An unknown value falls back to `default` and is
 * reported by validate-lab, so a typo shows a plain slide rather than nothing. */
export const LAYOUTS = [
  "default",
  "title",
  "section",
  "split",
  "stats",
  "quote",
];

/** Surface variants of the Docker theme. */
export const THEMES = ["light", "dark", "tint"];

export function DeckContextProvider({ children }) {
  const workshop = useWorkshop();
  const { variables } = useVariables();
  const { labId, sectionId } = useParams();
  const navigate = useNavigate();

  const basePath = labId ? `/labs/${labId}` : "";

  // Every chapter's slides, flattened into the single sequence the learner walks
  // through. Chapters are an authoring convenience (one file per topic); the
  // presented deck is flat.
  const slides = useMemo(
    () => (workshop.sections || []).flatMap((section) => section.slides || []),
    [workshop],
  );

  // Position comes from the URL. An unknown or absent id means the first slide,
  // so `#/labs/<id>` opens the deck at the start.
  const indexFromUrl = useMemo(() => {
    if (!sectionId) return 0;
    const at = slides.findIndex((s) => s.id === sectionId);
    return at < 0 ? 0 : at;
  }, [sectionId, slides]);

  const [fragment, setFragment] = useState(0);

  // Reset the fragment whenever the slide changes, so arriving at a slide always
  // shows it in its initial state rather than mid-reveal.
  const prevIndexRef = useRef(indexFromUrl);
  useEffect(() => {
    if (prevIndexRef.current !== indexFromUrl) {
      prevIndexRef.current = indexFromUrl;
      setFragment(0);
    }
  }, [indexFromUrl]);

  const current = slides[indexFromUrl] ?? null;

  // How many fragment steps this slide has. Counted from the rendered markdown
  // rather than declared, so an author just writes `::fragment` and the count
  // follows.
  const fragmentCount = useMemo(
    () => (current ? countFragments(current.content) : 0),
    [current],
  );

  const goTo = useCallback(
    (index) => {
      const clamped = Math.max(0, Math.min(index, slides.length - 1));
      const target = slides[clamped];
      if (!target) return;
      navigate(`${basePath}/${target.id}`);
    },
    [slides, navigate, basePath],
  );

  // Forward: advance through this slide's fragments first, then to the next
  // slide. That's what makes a fragmented slide feel like one continuous beat
  // rather than a separate mode the presenter has to think about.
  const next = useCallback(() => {
    if (fragment < fragmentCount) {
      setFragment((f) => f + 1);
      return;
    }
    goTo(indexFromUrl + 1);
  }, [fragment, fragmentCount, goTo, indexFromUrl]);

  // Back: rewind fragments, then step to the previous slide. Landing on the
  // previous slide shows it fully revealed — going back should show what you
  // already saw, not replay the reveal.
  const previous = useCallback(() => {
    if (fragment > 0) {
      setFragment((f) => f - 1);
      return;
    }
    if (indexFromUrl === 0) return;
    const target = slides[indexFromUrl - 1];
    setFragment(countFragments(target.content));
    goTo(indexFromUrl - 1);
  }, [fragment, indexFromUrl, slides, goTo]);

  // Variables are substituted at render time, exactly as in a lab, so a deck can
  // use $$name$$ and share the mechanism.
  const content = useMemo(
    () =>
      current ? substituteVariables(current.content, variables || {}) : "",
    [current, variables],
  );
  const notes = useMemo(
    () => (current ? substituteVariables(current.notes, variables || {}) : ""),
    [current, variables],
  );
  // The slide's regions (the columns of a `split`), substituted the same way.
  // Every layout reads this; non-split layouts simply use the first entry.
  const regions = useMemo(
    () =>
      (current?.regions ?? []).map((region) =>
        substituteVariables(region, variables || {}),
      ),
    [current, variables],
  );

  // Presentation config: the slide's own settings layered over the deck's
  // defaults, so an author sets the brand once in labspace.yaml and overrides
  // per slide only where a slide differs.
  const layout = useMemo(() => {
    const raw = current?.config?.layout;
    return LAYOUTS.includes(raw) ? raw : "default";
  }, [current]);

  // Precedence: the slide's own theme, then the layout's default, then the deck
  // default, then light.
  //
  // The layout default deliberately outranks the DECK default. A deck-wide
  // `theme: light` means "content slides are light" — read as outranking the
  // layout it would flatten every chapter marker back to white, which is the one
  // thing a divider slide exists not to be. An author who genuinely wants a light
  // divider says so on that slide, where it's visible.
  const theme = useMemo(() => {
    const fromSlide = current?.config?.theme;
    if (THEMES.includes(fromSlide)) return fromSlide;
    if (layout === "title") return "dark";
    if (layout === "section") return "tint";
    return THEMES.includes(workshop.theme) ? workshop.theme : "light";
  }, [current, workshop.theme, layout]);

  // Chrome text. An explicit empty string suppresses a band the deck default
  // would otherwise supply, which is why this checks for undefined rather than
  // falsiness.
  const chrome = useMemo(() => {
    const config = current?.config ?? {};
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
      logo: resolveAsset(pick("logo"), current?.baseUrl) ?? null,
      showChrome: config.chrome !== false && brand.chrome !== false,
    };
  }, [current, workshop.brand]);

  const value = useMemo(
    () => ({
      slides,
      index: indexFromUrl,
      total: slides.length,
      current,
      content,
      regions,
      notes,
      layout,
      theme,
      chrome,
      fragment,
      fragmentCount,
      next,
      previous,
      goTo,
      isFirst: indexFromUrl === 0,
      isLast: indexFromUrl === slides.length - 1,
    }),
    [
      slides,
      indexFromUrl,
      current,
      content,
      regions,
      notes,
      layout,
      theme,
      chrome,
      fragment,
      fragmentCount,
      next,
      previous,
      goTo,
    ],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

/**
 * Resolves a slide-relative asset path against the slide's directory, so a config
 * value like `logo: assets/docker-logo-white.svg` behaves like every other path in
 * a lab. Absolute paths, full URLs, and already-resolved values pass through.
 */
function resolveAsset(path, baseUrl) {
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
function countFragments(markdown) {
  const matches = (markdown || "").match(/^\s*:::fragment\b/gm);
  return matches ? matches.length : 0;
}

export const useDeck = () => useContext(DeckContext);
