// The loading-and-parsing tier: everything needed to turn a labspace.yaml into
// a resolved config, and to read/write a learner's local progress.
//
// Separate from the main entry because it pulls in NO React and no renderer.
// Two consumers care:
//
//   - A build-time host. An Astro page that resolves its scenario in
//     frontmatter (so the instructions are pre-rendered into the served HTML)
//     needs `loadLabspace` with a filesystem `fetchText` — and must not drag
//     react-markdown, mermaid, and the syntax highlighter into its Node build.
//   - Tooling. Validators and catalog generators want the same parse the app
//     uses, without a DOM.
//
// Everything here is also re-exported from the package root, so a host that
// wants the whole runtime imports one specifier.

export { loadLabspace } from "./labspace/loader";
export { slugify, substituteVariables } from "./labspace/slugify";
export { scopedKey } from "./labspace/storage";
export { resolveTracking } from "./labspace/tracking";
export * as progress from "./labspace/progress";
