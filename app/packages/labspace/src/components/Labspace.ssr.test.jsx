import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Labspace } from "../index.js";

// The runtime must survive a SERVER render, because that is what an Astro host
// does to an island before hydrating it (`client:load`). Two things this pins,
// both of which are one careless import away from breaking:
//
//   1. NO HEADLESS BROWSER ON THE SERVER. `rehype-mermaid` reaches
//      `mermaid-isomorphic`, which under Node's export condition is backed by
//      playwright. While that plugin was a static import, merely importing the
//      renderer in a server build demanded playwright — a dependency this package
//      does not and should not have — so an Astro host was forced onto
//      `client:only`. Mermaid is now loaded from inside an effect, which the
//      server never runs. The lab below CONTAINS a diagram, so a regression here
//      fails rather than passing by accident.
//
//   2. A BUILD-TIME CONFIG RENDERS ON THE FIRST PASS. A host that resolved the
//      lab at build time should get the lab's shell, not a loading spinner, so
//      variables and the opening section are seeded synchronously from `config`
//      rather than in an effect.
//
// The instruction MARKDOWN is deliberately not asserted: react-markdown's
// MarkdownHooks builds its tree in an effect, so the body is empty server-side no
// matter what. See docs/embedding-in-learn.md §3.3.

const config = {
  title: "Demo",
  baseUrl: "https://example.test/labs/demo/",
  sections: [
    {
      id: "intro",
      title: "Intro",
      baseUrl: "https://example.test/labs/demo/",
      contentRaw: "# Hello\n\n```mermaid\nflowchart LR\n  A --> B\n```\n",
      slides: [],
      steps: [],
    },
  ],
  services: [],
  variables: {},
  files: {},
  terminals: [{ id: "terminal", title: "Terminal", icon: "terminal" }],
  features: {},
  tracking: null,
  version: null,
  simulatorSpec: "version: 2\nscenarios: []\n",
};

describe("server rendering", () => {
  it("renders a lab containing a diagram without needing playwright", () => {
    expect(() =>
      renderToString(<Labspace config={config} labKey="ssr" />),
    ).not.toThrow();
  });

  it("renders the lab's shell, not a loading state", () => {
    const html = renderToString(<Labspace config={config} labKey="ssr" />);

    expect(html).toContain("workshop-panel");
    expect(html).toContain("terminal-panel");
    expect(html).not.toContain("labspace-loadstate");
  });
});
