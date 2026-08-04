// React surface of the package. Two layers, pick by how much you need:
//
//   <SimTerminal spec={yaml} />   one terminal from a spec string. The default
//                                 choice for a docs page, a slide, a demo.
//   <MockTerminal simulator={…} /> the terminal alone, over a Simulator you own.
//                                 Use when several terminals must share ONE
//                                 simulator (one state tree, one filesystem).
//
// The component imports its own stylesheet, so it arrives styled with no extra
// step in any bundler. The sheet is ALSO exposed as a subpath for consumers that
// can't rely on CSS side-effect imports (SSR, a plain <link>, a strict CSP):
//
//   import "@dockersamples/simspace-simulator/react/styles.css";
//
// It is fully self-contained — its own custom properties and a system monospace
// stack, no CSS framework and no webfont — so it drops into any host page
// without inheriting or leaking styles.

export { MockTerminal } from "./MockTerminal";
export type {
  MockTerminalHandle,
  MockTerminalProps,
  TerminalChange,
  TerminalEvent,
} from "./MockTerminal";

export { SimTerminal } from "./SimTerminal";
export type { SimTerminalProps } from "./SimTerminal";
