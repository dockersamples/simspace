import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useDeck } from "../../context/DeckContext";
import { useWorkshop } from "../../WorkshopContext";
import { useCatalog } from "../../context/CatalogContext";
import { MarkdownRenderer } from "../WorkshopPanel/markdown/MarkdownRenderer";
import { SpeakerNotesWindow } from "./SpeakerNotesWindow";
import { FragmentContext } from "./FragmentContext";
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
  const stageRef = useRef(null);

  const { next, previous, goTo, index, total, current } = deck;

  // Keyboard navigation, scoped so it never steals a keystroke meant for
  // something else. An in-slide terminal is a real text input: if space or the
  // arrows advanced the deck while someone was typing a command, live demos
  // would be unusable. So we bail whenever focus is in an editable element —
  // the same rule a slide library applies, but here it also covers the case
  // that bit reveal.js in testing: the terminal hides its input row while
  // output streams, and the focused element becomes the terminal body instead.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          event.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          previous();
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(total - 1);
          break;
        case "f":
          event.preventDefault();
          toggleFullscreen(stageRef.current);
          break;
        case "s":
          event.preventDefault();
          setNotesOpen((open) => !open);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, previous, goTo, total]);

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
      next();
    },
    [next],
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
    <div className="deck">
      <div className="deck-stage" ref={stageRef} onClick={onStageClick}>
        {/* The canvas is a 16:9 box that is also a size container, so every type
            scale below can be expressed in `cqi` and stay proportional at any
            display size — the fidelity a fixed 1920×1080 canvas would give,
            without `transform: scale()` blurring the live demo terminal or
            turning overflow into a hard clip. */}
        <article
          className={`deck-canvas deck-canvas--${deck.layout} deck-canvas--${deck.theme}`}
          key={current.id}
        >
          {/* Fragments are revealed by CSS driven from context, so the markdown
              renderer stays unaware of presentation state. */}
          <FragmentContext.Provider value={deck.fragment}>
            <SlideChrome position="top" />
            <div className="deck-body">
              <SlideRegions />
            </div>
            <SlideChrome position="bottom" />
          </FragmentContext.Provider>
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
            onClick={() => toggleFullscreen(stageRef.current)}
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
  const { layout, regions, current } = useDeck();
  const baseUrl = current?.baseUrl;

  const render = (markdown, key, className) => (
    <div className={className} key={key}>
      <MarkdownRenderer baseUrl={baseUrl}>{markdown}</MarkdownRenderer>
    </div>
  );

  if (layout === "split" && regions.length > 1) {
    const hasHeader = regions.length > 2;
    const header = hasHeader ? regions[0] : null;
    const columns = hasHeader ? regions.slice(1) : regions;
    return (
      <>
        {header && render(header, "header", "deck-region deck-region--header")}
        <div
          className="deck-columns"
          style={{ "--deck-columns": columns.length }}
        >
          {columns.map((region, i) => render(region, i, "deck-region"))}
        </div>
      </>
    );
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
 * Whether a keystroke belongs to something the learner is typing into, in which
 * case the deck must not act on it.
 */
function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (target.isContentEditable) return true;
  if (target.matches("input, textarea, select")) return true;
  // The whole demo-terminal REGION, not just its input. MockTerminal unmounts
  // the input row while output streams, so during a demo the focused element is
  // the (focusable) `.slide-terminal` wrapper rather than the input — and a
  // keystroke then still belongs to the terminal, not the deck.
  return Boolean(target.closest(".mock-term, .slide-terminal"));
}

function toggleFullscreen(element) {
  const target = element || document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    target.requestFullscreen?.();
  }
}
