// Keyboard navigation, shared by the slide view and the presenter window.
//
// It's shared rather than duplicated because the presenter window is a genuinely
// separate `window`: a keydown there never reaches the opener's listener, so each
// window has to bind its own. Two copies of this mapping would drift, and the
// symptom would be arrow keys that work on one screen and not the other — the sort
// of thing you only notice mid-talk.

/**
 * Whether a keystroke belongs to something the user is typing into, in which case
 * the deck must not act on it.
 */
export function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (target.isContentEditable) return true;
  if (target.matches("input, textarea, select")) return true;
  // The whole demo-terminal REGION, not just its input. MockTerminal unmounts the
  // input row while output streams, so during a demo the focused element is the
  // (focusable) `.slide-terminal` wrapper rather than the input — and a keystroke
  // then still belongs to the terminal, not the deck.
  return Boolean(target.closest(".mock-term, .slide-terminal"));
}

/**
 * Applies the deck's navigation keys. Returns true when the event was handled, so
 * a caller can layer window-specific keys on top without re-checking the guards.
 *
 * @param {KeyboardEvent} event
 * @param {{next: Function, previous: Function, goTo: Function, total: number}} deck
 */
export function handleDeckNavKey(event, { next, previous, goTo, total }) {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;

  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      // preventDefault matters beyond scrolling: with a chrome button focused,
      // Space would otherwise ALSO activate the button and advance twice.
      event.preventDefault();
      next();
      return true;
    case "ArrowLeft":
    case "PageUp":
      event.preventDefault();
      previous();
      return true;
    case "Home":
      event.preventDefault();
      goTo(0);
      return true;
    case "End":
      event.preventDefault();
      goTo(total - 1);
      return true;
    default:
      return false;
  }
}
