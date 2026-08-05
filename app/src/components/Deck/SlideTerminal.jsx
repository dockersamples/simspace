import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MockTerminal } from "@dockersamples/simspace-simulator/react";
import { useTerminal } from "../../context/TerminalContext";
import { useChildWindow } from "../PanelWindow/useChildWindow";
import "./SlideTerminal.scss";

// `::terminal{id=demo height=340}` — a live demo terminal embedded in a slide.
//
// It runs on the SAME shared Simulator as every other terminal in the deck, so
// state accumulates across slides the way it would in a real demo: something
// started on slide 4 is still running on slide 9. The code fence above it keeps
// its normal Run button (targeted with `terminal-id=`), so the presenter clicks
// Run and the scripted output streams into the slide.
//
// The pop-out button moves the terminal into a second browser window via a
// portal, for the projector case: deck on the big screen, terminal on the laptop.
// Because a portal follows the React tree rather than the DOM tree, it is the
// same terminal — same simulator, same transcript, no message bus.
export function SlideTerminal({ node }) {
  const terminal = useTerminal();
  const props = node?.properties ?? {};

  // Match the id to a declared terminal so `terminal-id=` on a code fence and
  // `when.terminal` in the simulator spec line up. An unknown id falls back to
  // the primary terminal rather than rendering a dead panel.
  const terminalId = terminal?.resolveTerminalId?.(props.id) ?? props.id;
  const height = props.height ? Number(props.height) : 320;

  const [poppedOut, setPoppedOut] = useState(false);
  const dockBack = useCallback(() => setPoppedOut(false), []);
  const container = useChildWindow({
    open: poppedOut,
    title: `Demo terminal — ${terminalId}`,
    name: "sbxlab-deck-terminal",
    onBlocked: dockBack,
    onClosed: dockBack,
  });

  const registerRef = useRef(null);
  if (!registerRef.current && terminal?.register) {
    registerRef.current = (handle) => terminal.register(terminalId, handle);
  }

  // Feed shared-state changes back through the context so peers refresh, exactly
  // as TerminalPanel does for a lab.
  const onChange = useCallback(() => {
    terminal?.broadcast?.({ type: "state" });
  }, [terminal]);

  // Escape hands keyboard control back to the deck.
  //
  // Without it there's a trap: the terminal correctly owns every keystroke while
  // it has focus (so typing a command doesn't flip slides), which also means a
  // presenter who clicks into it can no longer advance with the arrow keys and
  // has no obvious way out — the deck looks frozen. Blurring on Escape is the
  // conventional way out of an embedded input, and clicking the slide background
  // works too.
  const onKeyDown = useCallback((event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.currentTarget.blur();
    // Also blur whatever inside it holds focus (the terminal's own input), or
    // focus would simply stay put.
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      typeof active.blur === "function"
    ) {
      active.blur();
    }
  }, []);

  // A deck may declare no `simulator:` at all. Say so plainly rather than
  // rendering an inert black box the author will file a bug about.
  if (!terminal?.simulator && !terminal?.error) {
    return (
      <div className="slide-terminal slide-terminal-missing">
        <p>
          No simulator configured for this deck. Add a <code>simulator:</code>{" "}
          path to its <code>labspace.yaml</code> to run live demos.
        </p>
      </div>
    );
  }

  const term = (
    <MockTerminal
      ref={registerRef.current}
      simulator={terminal.simulator}
      error={terminal.error}
      terminalId={terminalId}
      // No storageKey: a demo terminal starts clean every time the deck is
      // opened. A presenter rehearsing then presenting wants a fresh machine,
      // not last night's transcript.
      onChange={onChange}
      subscribe={terminal.subscribe}
      className="slide-terminal-term"
    />
  );

  return (
    // tabIndex makes this region focusable, which is load-bearing rather than an
    // a11y nicety. MockTerminal UNMOUNTS its input row while output streams, so a
    // click during a demo would otherwise leave focus on document.body — and the
    // next keystroke (a space, say) would fall through to the deck and advance the
    // slide mid-demo. With the wrapper focusable, Chrome focuses it instead of the
    // body, so focus stays inside the terminal region and DeckView's keyboard
    // guard keeps holding. Verified by the "typing does not navigate" check.
    <div
      className="slide-terminal"
      style={{ height }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="slide-terminal-bar">
        <span className="slide-terminal-label">
          <span className="material-symbols-outlined">terminal</span>
          {terminalId}
        </span>
        <span className="slide-terminal-actions">
          <span className="slide-terminal-hint">Esc to leave</span>
          <button
            type="button"
            className="slide-terminal-btn"
            onClick={() => terminal.resetAll?.()}
            title="Reset the demo"
          >
            <span className="material-symbols-outlined">restart_alt</span>
          </button>
          <button
            type="button"
            className="slide-terminal-btn"
            onClick={() => setPoppedOut((out) => !out)}
            title={poppedOut ? "Bring the terminal back" : "Open in a window"}
          >
            <span className="material-symbols-outlined">
              {poppedOut ? "dock_to_right" : "open_in_new"}
            </span>
          </button>
        </span>
      </div>

      {poppedOut ? (
        <>
          <div className="slide-terminal-placeholder">
            Terminal opened in a separate window.
          </div>
          {container ? createPortal(term, container) : null}
        </>
      ) : (
        term
      )}
    </div>
  );
}
