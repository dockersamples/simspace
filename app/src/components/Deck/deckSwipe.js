// Touch navigation: swipe left/right to move through the deck on a phone or
// tablet.
//
// It sits beside `deckKeys.js` for the same reason that file exists — the deck is
// hand-rolled, so the input mapping is ours to own — and it reuses that file's
// `isTypingTarget` so a gesture and a keystroke agree about who owns the event. A
// swipe that starts inside a demo terminal belongs to the terminal (its transcript
// scrolls, and on a touch device that scroll is a drag), exactly as a keystroke
// there does.
//
// Two deliberate choices about how little this does:
//
//   - **Nothing is prevented.** The listeners are passive, so pinch-zoom still
//     works (a 16:9 slide on a phone is small, and zooming to read it is a
//     legitimate thing to do) and a vertical drag still scrolls an overflowing
//     region. Recognition is after the fact: we only look at where the finger
//     ended up.
//   - **Recognition is a pure function.** `recognizeSwipe` takes deltas and
//     returns a direction, so the thresholds are unit-tested rather than
//     eyeballed on a device.

import { useCallback, useEffect, useRef } from "react";
import { isTypingTarget } from "./deckKeys";

// Far enough that it can't be a tap's wobble (a finger moves a few pixels on any
// tap), short enough that a flick with the thumb counts.
const SWIPE_MIN_DISTANCE = 44;

// How much vertical drift a horizontal swipe may carry. A thumb arcs, so demanding
// a straight line rejects real swipes; allowing more than the horizontal distance
// would start stealing scrolls.
const SWIPE_OFF_AXIS_RATIO = 0.8;

// Longer than this is a drag, not a swipe — someone panning a zoomed slide or
// resting a finger while they read. Generous, because the off-axis and distance
// rules do most of the work.
const SWIPE_MAX_DURATION = 1000;

// How long a recognised swipe suppresses the tap-to-advance click.
//
// This is the one piece of state that isn't just geometry. A browser may fire a
// click after a touch sequence it decided was a tap, and if that lands on the
// stage after we've already navigated, the deck jumps two beats — or, worse,
// swipe-back-then-click cancels itself out and the deck looks stuck. The window
// only has to outlast the synthetic click, which follows touchend immediately.
const CLICK_SUPPRESS_MS = 700;

/**
 * Which way a completed gesture navigates, or null when it wasn't a swipe.
 *
 * Pure and exported for the tests: the thresholds above are the whole behaviour,
 * and getting them wrong is the kind of thing that's only obvious on a device.
 *
 * @param {{dx: number, dy: number, dt: number}} gesture pixels moved and ms taken
 * @returns {"next" | "previous" | null}
 */
export function recognizeSwipe({ dx, dy, dt }) {
  if (!(dt >= 0) || dt > SWIPE_MAX_DURATION) return null;
  const distance = Math.abs(dx);
  if (distance < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(dy) > distance * SWIPE_OFF_AXIS_RATIO) return null;
  // Swiping left pulls the next slide in from the right, the direction of travel
  // every carousel and e-reader uses.
  return dx < 0 ? "next" : "previous";
}

/**
 * Whether something between `target` and `root` scrolls horizontally and has room
 * left to scroll, in which case the drag is that element's.
 *
 * This is not hypothetical: `.deck-region` sets `overflow-y: auto`, which makes its
 * `overflow-x` compute to `auto` as well, so a wide code block or table inside a
 * slide really does pan sideways. Navigating on that gesture would both scroll the
 * block and change the slide.
 */
function ownsHorizontalScroll(target, root) {
  let node = target instanceof Element ? target : null;
  while (node && node !== root.parentElement) {
    if (node.scrollWidth - node.clientWidth > 2) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Binds swipe navigation to the slide stage.
 *
 * Listeners are attached natively rather than through React props because React
 * registers `touchstart`/`touchmove` as passive at the root, which is a footgun
 * waiting for whoever later decides a gesture needs `preventDefault()` — better
 * that the passivity be visible right here.
 *
 * Takes the stage ELEMENT rather than a ref, so the listeners are bound the render
 * the stage appears — a ref's `.current` is invisible to the effect's dependencies,
 * and the deck renders an empty state before its slides have loaded.
 *
 * @param {HTMLElement | null} node the stage element
 * @param {{next: Function, previous: Function}} nav
 * @returns {() => boolean} whether a click should be ignored as a swipe's echo
 */
export function useDeckSwipe(node, { next, previous }) {
  // The in-flight gesture, or null when there's nothing we'd act on. Mutated in
  // place: these fire at touch-move rate and none of it belongs in render.
  const gestureRef = useRef(null);
  const swipedRef = useRef(false);
  const timerRef = useRef(0);

  useEffect(() => {
    if (!node) return undefined;

    const start = (event) => {
      gestureRef.current = null;
      // A second finger means pinch or pan, never a swipe.
      if (event.touches.length !== 1) return;
      const target = event.target;
      if (isTypingTarget(target) || ownsHorizontalScroll(target, node)) return;
      const touch = event.touches[0];
      gestureRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        dx: 0,
        dy: 0,
      };
    };

    const move = (event) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      // A finger arriving mid-gesture turns it into a zoom; abandon it.
      if (event.touches.length !== 1) {
        gestureRef.current = null;
        return;
      }
      const touch = event.touches[0];
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
    };

    const end = (event) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;
      // Mid text-selection, matching the click handler: the drag was a selection.
      if (window.getSelection()?.toString()) return;

      // Where the finger actually left the glass. `touches` is empty by then, so
      // the lifted finger is in `changedTouches`; the running move totals are the
      // fallback for a browser that reports neither.
      const lifted = event.changedTouches?.[0];
      const direction = recognizeSwipe({
        dx: lifted ? lifted.clientX - gesture.x : gesture.dx,
        dy: lifted ? lifted.clientY - gesture.y : gesture.dy,
        dt: event.timeStamp - gesture.time,
      });
      if (!direction) return;

      swipedRef.current = true;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        swipedRef.current = false;
      }, CLICK_SUPPRESS_MS);

      if (direction === "next") next();
      else previous();
    };

    const cancel = () => {
      gestureRef.current = null;
    };

    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: true });
    node.addEventListener("touchend", end, { passive: true });
    node.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
    };
  }, [node, next, previous]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return useCallback(() => swipedRef.current, []);
}
