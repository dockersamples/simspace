import { visit } from "unist-util-visit";

/**
 * Numbers `:::fragment` containers in document order so each knows its position
 * in the slide's reveal sequence. Authors write `:::fragment` and nothing else —
 * hand-numbered fragments would be one more thing to renumber when a slide is
 * reordered.
 *
 * Must run AFTER the directive plugin that sets `hProperties` from a directive's
 * attributes, since that assignment replaces the object wholesale; this merges
 * into whatever is already there.
 */
export function remarkFragmentIndexer() {
  return (tree) => {
    let index = 0;
    visit(tree, "containerDirective", (node) => {
      if (node.name !== "fragment") return;
      const data = node.data || (node.data = {});
      data.hName = "fragment";
      data.hProperties = {
        ...(data.hProperties || {}),
        "data-fragment-index": index++,
      };
    });
  };
}
