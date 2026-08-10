import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useDeck } from "../../context/DeckContext";
import { useWorkshop } from "../../WorkshopContext";
import { useCatalog } from "../../context/CatalogContext";
import { MarkdownRenderer } from "../WorkshopPanel/markdown/MarkdownRenderer";
import { SpeakerNotesWindow } from "./SpeakerNotesWindow";
import { SlideErrorBoundary } from "./SlideErrorBoundary";
import { FragmentContext } from "./FragmentContext";
import { handleDeckNavKey, isTypingTarget } from "./deckKeys";
import { useDeckSwipe } from "./deckSwipe";
import "./DeckView.scss";

// The deck. Renders one slide at a time full-bleed, with presenter chrome and
// keyboard navigation.
//
// Deliberately hand-rolled rather than reveal.js. Two reasons decided it: the
// router already owns position (reveal wants the hash too), and an in-slide
// terminal needs keyboard focus to belong to whatever the learner is typing into
// — which is the opposite of a slide library's default of binding arrows and
// space globally. See docs/slidedeck-exploration.md §6.

export function DeckView() {
  const workshop = useWorkshop();
  const catalog = useCatalog();
  const deck = useDeck();
  const [notesOpen, setNotesOpen] = useState(false);
  // "Present" hides the app's own chrome and lets the slide fill the window,
  // WITHOUT entering browser fullscreen — so a screen capture of the window
  // contains the slide and nothing else. Distinct from `f` (real fullscreen),
  // which a recording tool may not be able to capture from.
  const [presenting, setPresenting] = useState(false);
  // The stage is held in state rather than a ref because the swipe listeners are
  // bound to the element itself, and an effect can't depend on a ref's `.current`.
  const [stage, setStage] = useState(null);

  const { next, previous, goTo, index, total, current } = deck;

  // Swipe navigation for phones and tablets. Returns the guard the click handler
  // below uses to ignore the click a browser may fire after a swipe.
  const swipedRecently = useDeckSwipe(stage, { next, previous });

  // Keyboard navigation, scoped so it never steals a keystroke meant for
  // something else. An in-slide terminal is a real text input: if space or the
  // arrows advanced the deck while someone was typing a command, live demos
  // would be unusable. So we bail whenever focus is in an editable element —
  // the same rule a slide library applies, but here it also covers the case
  // that bit reveal.js in testing: the terminal hides its input row while
  // output streams, and the focused element becomes the terminal body instead.
  useEffect(() => {
    const onKeyDown = (event) => {
      // Navigation first, shared with the presenter window so the two can't
      // disagree about what an arrow key does.
      if (handleDeckNavKey(event, { next, previous, goTo, total })) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      switch (event.key) {
        case "f":
          event.preventDefault();
          toggleFullscreen(stage);
          break;
        case "s":
          event.preventDefault();
          setNotesOpen((open) => !open);
          break;
        case "p":
          event.preventDefault();
          setPresenting((on) => !on);
          break;
        case "Escape":
          // Only meaningful as an exit. Inside a demo terminal, SlideTerminal
          // stops Escape before it reaches here (it blurs instead), so this
          // never steals the terminal's way out.
          if (presenting) {
            event.preventDefault();
            setPresenting(false);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, previous, goTo, total, presenting, stage]);

  // Clicking the slide background advances, the way a presenter expects. Only
  // the background: a click on a link, button, or the terminal is that element's
  // business, and swallowing it would break every interactive slide.
  const onStageClick = useCallback(
    (event) => {
      if (
        event.target.closest("a, button, input, .mock-term, .slide-terminal")
      ) {
        return;
      }
      if (window.getSelection()?.toString()) return; // mid text-selection
      // A touch device may fire a click at the end of a swipe. Acting on it would
      // advance a second time, or undo the swipe back the learner just made.
      if (swipedRecently()) return;
      next();
    },
    [next, swipedRecently],
  );

  if (!current) {
    return (
      <div className="deck deck-empty">
        <p>This deck has no slides yet.</p>
        <p className="deck-empty-hint">
          Add a markdown file under <code>slides:</code> in its{" "}
          <code>labspace.yaml</code>, splitting slides with a <code>---</code>{" "}
          line.
        </p>
      </div>
    );
  }

  const showCatalogLink = (catalog.labs?.length ?? 0) > 1;

  return (
    <div className={"deck" + (presenting ? " deck--presenting" : "")}>
      {presenting && <PresentHint />}
      <div className="deck-stage" ref={setStage} onClick={onStageClick}>
        {/* The canvas is a 16:9 box that is also a size container, so every type
            scale below can be expressed in `cqi` and stay proportional at any
            display size — the fidelity a fixed 1920×1080 canvas would give,
            without `transform: scale()` blurring the live demo terminal or
            turning overflow into a hard clip. */}
        <article
          className={`deck-canvas deck-canvas--${deck.layout} deck-canvas--${deck.theme}`}
          key={current.id}
        >
          {/* `layout: image` bleeds its picture to the canvas edge, so it hangs
              here rather than inside the frame — the frame's padding is exactly
              what a full-bleed image needs to escape. */}
          <SlideBleedImage />
          {/* The canvas carries no padding of its own, and the frame inside it
              carries all of it. That's load-bearing: container query units resolve
              against the container's CONTENT box, so padding on the canvas would
              silently shrink every `cqi` in the theme — 5cqi of padding made every
              size 10% smaller than the type scale said. With the padding one level
              in, 1cqi is exactly 1% of the slide's width. */}
          <div className="deck-frame">
            {/* Fragments are revealed by CSS driven from context, so the markdown
                renderer stays unaware of presentation state. */}
            <FragmentContext.Provider value={deck.fragment}>
              <SlideChrome position="top" />
              <div className="deck-body">
                {/* The boundary rides the canvas's `key={current.id}`, so it
                    remounts on every slide change — an error boundary holds its
                    failed state until it unmounts, and without that a single bad
                    slide would leave every later slide blank too. */}
                <SlideErrorBoundary>
                  <SlideRegions />
                </SlideErrorBoundary>
              </div>
              <SlideChrome position="bottom" />
            </FragmentContext.Provider>
          </div>
        </article>
      </div>

      <footer className="deck-chrome">
        <div className="deck-chrome-left">
          {showCatalogLink && (
            <Link to="/" className="deck-btn" title="Back to all material">
              <span className="material-symbols-outlined">grid_view</span>
            </Link>
          )}
          <span className="deck-title">{workshop.title}</span>
        </div>

        <div className="deck-chrome-center">
          <button
            type="button"
            className="deck-btn"
            onClick={previous}
            disabled={deck.isFirst && deck.fragment === 0}
            aria-label="Previous slide"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="deck-counter" aria-live="polite">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            className="deck-btn"
            onClick={next}
            disabled={deck.isLast && deck.fragment === deck.fragmentCount}
            aria-label="Next slide"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>

        <div className="deck-chrome-right">
          <button
            type="button"
            className="deck-btn"
            onClick={() => setPresenting(true)}
            title="Present in this window — hides this bar (p)"
          >
            <span className="material-symbols-outlined">play_arrow</span>
          </button>
          <button
            type="button"
            className={"deck-btn" + (notesOpen ? " active" : "")}
            onClick={() => setNotesOpen((open) => !open)}
            title="Speaker notes (s)"
            aria-pressed={notesOpen}
          >
            <span className="material-symbols-outlined">speaker_notes</span>
          </button>
          <button
            type="button"
            className="deck-btn"
            onClick={() => toggleFullscreen(stage)}
            title="Fullscreen (f)"
          >
            <span className="material-symbols-outlined">fullscreen</span>
          </button>
        </div>

        <div
          className="deck-progress"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
        >
          <div
            className="deck-progress-bar"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
      </footer>

      {notesOpen && <SpeakerNotesWindow onClose={() => setNotesOpen(false)} />}
    </div>
  );
}

/**
 * The full-bleed picture behind a `layout: image` slide.
 *
 * A sibling of the frame rather than slide content, because the frame's padding
 * is the one thing a full-bleed image has to get past. Nothing renders for any
 * other layout — a picture in the text flow is an ordinary markdown image.
 */
function SlideBleedImage() {
  const { layout, image } = useDeck();
  if (layout !== "image" || !image) return null;
  return <img className="deck-image-bleed" src={image.src} alt={image.alt} />;
}

/**
 * The slide's content, arranged by layout.
 *
 * Every layout reads the same `regions` array, which is what keeps the layout set
 * cheap: only `split` cares that there is more than one region. The rest is CSS.
 *
 * `split` with THREE or more regions treats the first as a full-width header band
 * and the rest as columns; with two, both are columns. That one rule covers every
 * design in the reference deck — a spanning headline over two columns, and a
 * headline that lives *inside* the left column — without inspecting content or
 * adding a second layout name.
 */
function SlideRegions() {
  const { layout, regions, current, columns: weights } = useDeck();
  const baseUrl = current?.baseUrl;

  const render = (markdown, key, className) => (
    <div className={className} key={key}>
      <MarkdownRenderer baseUrl={baseUrl} runButtons="terminal-only">
        {markdown}
      </MarkdownRenderer>
    </div>
  );

  if (layout === "split" && regions.length > 1) {
    const hasHeader = regions.length > 2;
    const header = hasHeader ? regions[0] : null;
    const cols = hasHeader ? regions.slice(1) : regions;
    // Weights apply positionally; a list that doesn't match the column count is
    // ignored rather than padded, so adding a region can't silently re-weight
    // the rest of the slide.
    const tracks =
      weights && weights.length === cols.length
        ? weights.map((w) => `minmax(0, ${w}fr)`).join(" ")
        : null;
    return (
      <>
        {header && render(header, "header", "deck-region deck-region--header")}
        <div
          className="deck-columns"
          style={{
            "--deck-columns": cols.length,
            ...(tracks ? { "--deck-column-tracks": tracks } : {}),
          }}
        >
          {cols.map((region, i) => render(region, i, "deck-region"))}
        </div>
      </>
    );
  }

  // `image` puts the picture behind the slide and the words in a panel over it.
  // The image is config rather than markdown so the layout can bleed it to the
  // edges — an `![]()` in the body is a figure in the text flow, which is the
  // other, already-supported thing.
  if (layout === "image") {
    const body = regions.join("\n\n").trim();
    // The picture itself is rendered at canvas level by SlideBleedImage; what's
    // left here is the panel of words that sits over it.
    return body
      ? render(body, "only", "deck-region deck-region--overlay")
      : null;
  }

  // Any other layout ignores region markers and renders the whole slide. Joining
  // rather than dropping the extras means a stray marker loses the column break,
  // not the content.
  return render(regions.join("\n\n"), "only", "deck-region");
}

/**
 * The branded top and bottom bands: logo + eyebrow above, source + page number
 * below. Driven entirely by config (deck-level `brand`, overridable per slide),
 * so a deck opts into the full Docker chrome without any slide markup.
 */
function SlideChrome({ position }) {
  const { chrome, index, total, layout } = useDeck();
  if (!chrome.showChrome) return null;

  if (position === "top") {
    if (!chrome.logo && !chrome.eyebrow) return null;
    return (
      <header className="deck-topbar">
        {chrome.logo ? (
          <img className="deck-logo" src={chrome.logo} alt="" />
        ) : (
          <span />
        )}
        {chrome.eyebrow && (
          <span className="deck-eyebrow">{chrome.eyebrow}</span>
        )}
      </header>
    );
  }

  // A title slide carries a byline where a content slide carries its source.
  const left =
    layout === "title" && chrome.byline ? chrome.byline : chrome.source;
  return (
    <footer className="deck-footer">
      <span className="deck-source">{left}</span>
      <span className="deck-pagenum">
        {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
    </footer>
  );
}

/**
 * A brief "press Esc" note when present mode starts, then gone.
 *
 * Present mode exists so a screen capture contains the slide and nothing else, so
 * a persistent exit affordance would defeat the point — but a mode with no visible
 * way out reads as a frozen app. A hint that removes itself is the compromise:
 * long enough to read, gone well before anyone starts recording.
 */
function PresentHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="deck-present-hint" role="status">
      Presenting — press <kbd>Esc</kbd> to show the toolbar again
    </div>
  );
}

function toggleFullscreen(element) {
  const target = element || document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    target.requestFullscreen?.();
  }
}
