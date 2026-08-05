import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDeck } from "../../context/DeckContext";
import { useChildWindow } from "../PanelWindow/useChildWindow";
import { MarkdownRenderer } from "../WorkshopPanel/markdown/MarkdownRenderer";
import "./SpeakerNotesWindow.scss";

// The presenter view, in a second window: the current slide's `Note:` text, what's
// coming next, and an elapsed timer.
//
// It renders through the same portal mechanism as the popped-out terminal, so it
// tracks the deck live — advancing a slide on the projector updates this window
// with no synchronisation of its own. That's the whole reason to portal rather
// than open a second copy of the app: there is one deck, shown twice.
export function SpeakerNotesWindow({ onClose }) {
  const deck = useDeck();
  const container = useChildWindow({
    open: true,
    title: "Speaker notes",
    name: "sbxlab-speaker-notes",
    features: "width=720,height=800,menubar=no,toolbar=no,location=no",
    onBlocked: onClose,
    onClosed: onClose,
  });

  if (!container) return null;

  const nextSlide = deck.slides[deck.index + 1];

  return createPortal(
    <div className="notes">
      <header className="notes-header">
        <span className="notes-position">
          Slide {deck.index + 1} of {deck.total}
        </span>
        <ElapsedTimer />
      </header>

      <section className="notes-current">
        <h2 className="notes-label">Notes</h2>
        {deck.notes ? (
          <div className="notes-body">
            <MarkdownRenderer baseUrl={deck.current?.baseUrl}>
              {deck.notes}
            </MarkdownRenderer>
          </div>
        ) : (
          <p className="notes-empty">
            No notes for this slide. Add a <code>Note:</code> line to its
            markdown.
          </p>
        )}
      </section>

      <section className="notes-next">
        <h2 className="notes-label">Up next</h2>
        {nextSlide ? (
          <div className="notes-preview">
            <MarkdownRenderer baseUrl={nextSlide.baseUrl}>
              {nextSlide.content}
            </MarkdownRenderer>
          </div>
        ) : (
          <p className="notes-empty">End of the deck.</p>
        )}
      </section>

      <footer className="notes-footer">
        <button type="button" className="notes-btn" onClick={deck.previous}>
          ← Previous
        </button>
        <button type="button" className="notes-btn" onClick={deck.next}>
          Next →
        </button>
      </footer>
    </div>,
    container,
  );
}

// Elapsed time since the presenter view was opened — the number that actually
// matters mid-talk. Resettable, because rehearsing and then presenting are two
// different runs.
function ElapsedTimer() {
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const reset = useCallback(() => {
    const t = Date.now();
    setStart(t);
    setNow(t);
  }, []);

  const seconds = Math.floor((now - start) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <button
      type="button"
      className="notes-timer"
      onClick={reset}
      title="Click to reset"
    >
      {mm}:{ss}
    </button>
  );
}
