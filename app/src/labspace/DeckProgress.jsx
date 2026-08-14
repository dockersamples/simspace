// The deck's progress wiring.
//
// Two things make a deck's progress different from a lab's, and both are the
// app's business rather than the runtime's:
//
//   Position — a deck's "where am I" is the current SLIDE, not the chapter file
//   the slide came from. Reporting that keeps decks and labs on one event shape,
//   so pulse and the insights dashboard need no notion of what a deck is.
//
//   Completion — a deck has no steps to complete, so "finished" is reaching the
//   last slide. Recording it through the same completeLab path a lab uses is what
//   makes the catalog's Completed badge and pulse's lab_completed work for decks.
//   Note this fires on REACHING the final slide, not on reading it: there's no
//   honest signal for the latter, and requiring a press past the end would mean
//   most decks never registered as complete.

import { useEffect } from "react";
import {
  ProgressContextProvider,
  useProgress,
} from "@dockersamples/simspace-labspace";
import { useDeck } from "../context/DeckContext";
import { usePulseAnalytics } from "./usePulseAnalytics";

function DeckCompletion({ children }) {
  const deck = useDeck();
  const { completeLab } = useProgress();

  useEffect(() => {
    if (deck?.isLast) completeLab();
  }, [deck?.isLast, completeLab]);

  return children;
}

export function DeckProgress({ children }) {
  const deck = useDeck();
  const analytics = usePulseAnalytics();

  return (
    <ProgressContextProvider
      analytics={analytics}
      positionId={deck?.current?.id}
    >
      <DeckCompletion>{children}</DeckCompletion>
    </ProgressContextProvider>
  );
}
