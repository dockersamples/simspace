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
import { deriveSlidePresentation, countFragments } from "../deck/deriveSlide";
import {
  substituteVariables,
  useWorkshop,
  useVariables,
} from "@dockersamples/simspace-labspace";

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

// Exported so the print/export view can supply a synthetic value for EVERY
// slide at once (rather than "the current one", which is all the router-driven
// provider below tracks) and still reuse the exact same slide-rendering
// components as the live deck. See DeckExportView.
export const DeckContext = createContext(null);

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

  // Layout, theme, columns, image, chrome, and the substituted regions — one
  // shared function so the print/export view derives every slide the exact
  // same way instead of duplicating these rules (and risking them drifting).
  const { regions, layout, columns, image, theme, chrome } = useMemo(
    () => deriveSlidePresentation(current, { workshop, variables }),
    [current, workshop, variables],
  );

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
      columns,
      image,
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
      columns,
      image,
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

export const useDeck = () => useContext(DeckContext);
