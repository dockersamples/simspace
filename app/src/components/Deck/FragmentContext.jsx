import { createContext, useContext } from "react";

// How many fragments on the current slide have been revealed. Lives in its own
// module so the markdown renderer's component map can read it without importing
// the deck view.
//
// The default is Infinity — "everything is revealed" — which is what any context
// OTHER than a live deck wants: a lab, the print/export view, or a deck slide
// rendered as the "up next" preview in the speaker-notes window. Defaulting to 0
// would silently HIDE content in all of those, which is a much worse failure than
// showing a build fully assembled.
export const FragmentContext = createContext(Infinity);

export const useRevealedFragments = () => useContext(FragmentContext);
