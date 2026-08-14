import { useEffect, useMemo, useState } from "react";
import { diagramErrorFallback } from "./diagramError.js";

// Loads `rehype-mermaid` only when a document actually contains a diagram, and
// only in a browser.
//
// WHY IT IS NOT A STATIC IMPORT
//
// Mermaid is by far the heaviest thing the runtime can pull in — measured at
// 3.5 MB of the island's 6.1 MB of assets, because `mermaid-isomorphic` brings
// mermaid, katex and fontawesome. Every lab paid that, including the ones with no
// diagram in them, which is most.
//
// It also decided how a host could mount the runtime. `mermaid-isomorphic`
// resolves to a playwright-backed build under Node's export condition, so merely
// IMPORTING the renderer in a server build wanted playwright — which broke
// Astro's `client:load` (Astro server-renders islands during a static build) and
// forced `client:only`. Loading it from inside an effect means the server pass
// never evaluates it, because effects don't run there.
//
// The cost of this is one extra render for a document that has a diagram: the
// first pass has no mermaid plugin, so `hasDiagram` holds rendering until the
// plugin arrives. `MarkdownHooks` already renders nothing until its own effect
// runs, so a reader sees no additional flash.

// A ```mermaid fence, at the start of a line, allowing extra fence meta.
const MERMAID_FENCE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*mermaid\b/m;

const mermaidOptions = { errorFallback: diagramErrorFallback };

let cached = null;

/**
 * Returns `{ hasDiagram, plugin }` for the given markdown.
 *
 *   hasDiagram  the document contains a mermaid fence, so it needs the plugin
 *   plugin      the rehype plugin entry once loaded, else null
 *
 * A caller with `hasDiagram && !plugin` should render nothing yet — rendering
 * without the plugin would show the diagram source as a code block, then replace
 * it a moment later.
 */
export function useMermaidPlugin(markdown) {
  const hasDiagram = useMemo(
    () => MERMAID_FENCE.test(String(markdown ?? "")),
    [markdown],
  );
  const [plugin, setPlugin] = useState(cached);

  useEffect(() => {
    if (!hasDiagram || plugin) return undefined;
    let cancelled = false;
    import("rehype-mermaid")
      .then((mod) => {
        cached = [mod.default, mermaidOptions];
        if (!cancelled) setPlugin(cached);
      })
      .catch((error) => {
        // A diagram that can't be drawn must not take the lab down. Give up on
        // mermaid and let the fence render as a code block.
        console.error("Could not load the diagram renderer:", error);
        if (!cancelled) setPlugin([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasDiagram, plugin]);

  return { hasDiagram, plugin };
}
