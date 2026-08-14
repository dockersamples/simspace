// What to render when a mermaid diagram won't render.
//
// This exists because the default is catastrophic. `rehype-mermaid` THROWS when a
// diagram fails and no `errorFallback` is given, `MarkdownHooks` (react-markdown)
// rethrows a plugin error during render, and with no boundary above it React
// unmounts the tree — so one bad diagram on one slide blanks the entire app. Mid-talk
// that reads as "the deck crashed", with no way back except a reload.
//
// A diagram that can't be drawn should cost the author a diagram, not the deck. So
// we return a visible card instead: the message the renderer gave, and the diagram
// source underneath, which is the content the diagram was standing in for and is
// still readable as text.
//
// The message is shown rather than only logged on purpose. Mermaid renders in the
// BROWSER here, so a failure can be device-specific — and the device where that
// happens is often a phone, where nobody has a console attached.

/**
 * A hast element replacing a diagram that failed to render.
 *
 * @param {import('hast').Element} _element the `<pre>` the diagram came from
 * @param {string} diagram the mermaid source
 * @param {unknown} error whatever the renderer threw
 * @returns {import('hast').Element}
 */
export function diagramErrorFallback(_element, diagram, error) {
  const message =
    (error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error)) || "Unknown error";

  return {
    type: "element",
    tagName: "div",
    properties: { className: ["md-diagram-error"], role: "note" },
    children: [
      text("p", "md-diagram-error-title", "This diagram could not be rendered"),
      text("p", "md-diagram-error-message", message),
      {
        type: "element",
        tagName: "pre",
        properties: { className: ["md-diagram-error-source"] },
        children: [{ type: "text", value: diagram }],
      },
    ],
  };
}

function text(tagName, className, value) {
  return {
    type: "element",
    tagName,
    properties: { className: [className] },
    children: [{ type: "text", value }],
  };
}
