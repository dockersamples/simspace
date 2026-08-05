import { useRevealedFragments } from "./FragmentContext";

// A `:::fragment` container: a beat within a slide, revealed on the next press.
//
//   :::fragment
//   This appears second.
//   :::
//
// Hidden fragments stay in the layout (visibility, not display) so revealing one
// doesn't reflow what's already on screen — text jumping around mid-sentence is
// exactly what makes a build feel amateurish.
//
// The index comes from the DOM order of the rendered directives, which the remark
// plugin numbers as it walks the tree, so authors never number them by hand.
export function Fragment({ node, children }) {
  const revealed = useRevealedFragments();
  const index = Number(node?.properties?.dataFragmentIndex ?? 0);
  const shown = index < revealed;

  return (
    <div
      className={"deck-fragment" + (shown ? " revealed" : "")}
      aria-hidden={!shown}
    >
      {children}
    </div>
  );
}
