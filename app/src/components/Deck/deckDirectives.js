import { SlideTerminal } from "./SlideTerminal";
import { Fragment } from "./Fragment";
import { Card, Stat, Tag } from "./SlideParts";

// The deck's own markdown directives, handed to the runtime's MarkdownRenderer
// wherever slide markdown is rendered.
//
// They live here rather than in the runtime package because a deck is this
// app's feature — but they ride the SAME renderer the instructions pane uses, so
// slides get the whole authoring surface (Run buttons, mermaid, alerts,
// $$variables$$) for free instead of needing a second renderer that would drift.
//
// Each degrades sanely if it somehow appears outside a deck: `::terminal`
// renders a terminal on the shared simulator (or says there isn't one), and a
// `:::fragment` renders fully revealed.
export const deckDirectives = {
  terminal: SlideTerminal,
  fragment: Fragment,
  stat: Stat,
  card: Card,
  tag: Tag,
};
