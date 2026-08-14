// The lab app's own call into the package loader.
//
// The package renders labs, not slide decks — a deck is this app's feature, so
// the slide splitter lives here (deck/splitSlides.js) and is injected rather
// than imported by the package. Every place in the app that loads a labspace
// goes through this wrapper, so both kinds of entry work everywhere and the
// injection can't be forgotten at one call site.

import { loadLabspace } from "@dockersamples/simspace-labspace/loader";
import { parseSlides } from "../deck/splitSlides";

export function loadEntry(labUrl) {
  return loadLabspace(labUrl, { parseSlides });
}
