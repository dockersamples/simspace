// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { recognizeSwipe, useDeckSwipe } from "./deckSwipe";

// Swipe navigation is the one piece of deck UI worth unit-testing rather than
// checking on screen: reproducing a gesture by hand means picking up a phone, and
// the failures are quiet ones — a flick that does nothing, or a slide that jumps
// two at a time because a browser also fired a click.
//
// The suite runs in jsdom (the app's default environment is node) because the hook
// binds real listeners. jsdom implements no Touch API, so `touch()` below fakes the
// three fields the hook reads. That's a deliberately shallow stand-in: it proves
// the wiring and the guards, not that a real device reports the coordinates we
// expect.

/**
 * Dispatches a touch event carrying a single finger at (x, y). On `touchend` the
 * finger has left the glass, so it appears in `changedTouches` and `touches` is
 * empty — the shape the hook reads.
 */
function touch(type, target, x, y, time) {
  const event = new Event(type, { bubbles: true });
  const finger = [{ clientX: x, clientY: y }];
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : finger,
  });
  Object.defineProperty(event, "changedTouches", { value: finger });
  Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
}

/** A stage with one child to aim gestures at, plus the hook bound to it. */
function mountStage(child = document.createElement("p")) {
  const stage = document.createElement("div");
  stage.append(child);
  document.body.append(stage);
  const next = vi.fn();
  const previous = vi.fn();
  const { result } = renderHook(() => useDeckSwipe(stage, { next, previous }));
  return {
    stage,
    child,
    next,
    previous,
    swipedRecently: () => result.current(),
  };
}

// The thresholds ARE the behaviour: too strict and a real thumb-flick does nothing,
// too loose and every attempt to scroll a slide's overflowing code block jumps to
// the next slide.
describe("recognizeSwipe", () => {
  it("advances on a swipe to the left", () => {
    // Left pulls the next slide in from the right, as a carousel does.
    expect(recognizeSwipe({ dx: -120, dy: 8, dt: 220 })).toBe("next");
  });

  it("goes back on a swipe to the right", () => {
    expect(recognizeSwipe({ dx: 120, dy: -8, dt: 220 })).toBe("previous");
  });

  it("ignores a tap's wobble", () => {
    expect(recognizeSwipe({ dx: -6, dy: 3, dt: 90 })).toBeNull();
  });

  it("ignores a vertical scroll", () => {
    expect(recognizeSwipe({ dx: -10, dy: -260, dt: 300 })).toBeNull();
  });

  it("ignores a diagonal drag that is mostly vertical", () => {
    // A scroll that drifts sideways is still a scroll.
    expect(recognizeSwipe({ dx: -60, dy: 140, dt: 300 })).toBeNull();
  });

  it("allows the arc a thumb actually travels", () => {
    expect(recognizeSwipe({ dx: -110, dy: 60, dt: 280 })).toBe("next");
  });

  it("ignores a slow drag", () => {
    // Panning a zoomed slide, or a finger resting while someone reads.
    expect(recognizeSwipe({ dx: -300, dy: 0, dt: 4000 })).toBeNull();
  });

  it("ignores a gesture with no measurable duration", () => {
    // Guards against a clock that went backwards between the two events.
    expect(recognizeSwipe({ dx: -300, dy: 0, dt: -5 })).toBeNull();
  });

  it("is undecided exactly at the distance threshold", () => {
    expect(recognizeSwipe({ dx: -43, dy: 0, dt: 200 })).toBeNull();
    expect(recognizeSwipe({ dx: -44, dy: 0, dt: 200 })).toBe("next");
  });
});

describe("useDeckSwipe", () => {
  it("advances the deck on a leftward swipe over the slide", () => {
    const { child, next, previous } = mountStage();
    touch("touchstart", child, 300, 100, 0);
    touch("touchmove", child, 200, 110, 100);
    touch("touchend", child, 100, 120, 200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).not.toHaveBeenCalled();
  });

  it("does not navigate on a tap — the click handler owns that", () => {
    const { child, next, swipedRecently } = mountStage();
    touch("touchstart", child, 300, 100, 0);
    touch("touchend", child, 302, 101, 60);
    expect(next).not.toHaveBeenCalled();
    expect(swipedRecently()).toBe(false);
  });

  it("suppresses the click a browser may fire after a swipe", () => {
    // Without this the deck would advance twice, or a swipe back would cancel
    // itself out and look stuck.
    const { child, swipedRecently } = mountStage();
    touch("touchstart", child, 300, 100, 0);
    touch("touchend", child, 100, 100, 180);
    expect(swipedRecently()).toBe(true);
  });

  it("leaves a gesture that starts in a demo terminal to the terminal", () => {
    const term = document.createElement("div");
    term.className = "slide-terminal";
    const { next } = mountStage(term);
    touch("touchstart", term, 300, 100, 0);
    touch("touchmove", term, 200, 100, 100);
    touch("touchend", term, 100, 100, 200);
    expect(next).not.toHaveBeenCalled();
  });

  it("abandons a gesture that becomes a pinch", () => {
    const { child, next } = mountStage();
    touch("touchstart", child, 300, 100, 0);
    const pinch = new Event("touchmove", { bubbles: true });
    Object.defineProperty(pinch, "touches", {
      value: [
        { clientX: 200, clientY: 100 },
        { clientX: 400, clientY: 100 },
      ],
    });
    child.dispatchEvent(pinch);
    touch("touchend", child, 100, 100, 200);
    expect(next).not.toHaveBeenCalled();
  });
});
