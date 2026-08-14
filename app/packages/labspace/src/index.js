// Public API of @dockersamples/simspace-labspace.
//
// The package is the lab RUNTIME: the instruction panel, the multi-terminal
// pane over one shared simulator, and the CI tab — everything between a
// labspace.yaml and a learner, and nothing around it. The catalog/landing view,
// the slide deck, and the instructor dashboard are the lab APP's, not this
// package's; a host supplies its own routing, page shell, and navigation.
//
// It grows two tiers:
//
//   1. <Labspace> — the batteries-included island. One component, one config
//      (or one URL), a whole lab. This is what an embedding site mounts.
//   2. The runtime pieces — providers, contexts, the markdown renderer, and the
//      loader. A host that needs to compose the runtime differently reaches for
//      these; the lab app's own deck and print views are the first consumers.
//
// The loader, its supporting stores, and the context layer have moved; the
// panels and <Labspace> itself follow.

// ── Loading and parsing ────────────────────────────────────────────────────
// Also available on its own at "@dockersamples/simspace-labspace/loader", which
// pulls in no React — that is the entry a build-time host wants.
export * from "./loader";

// ── The runtime's context layer ────────────────────────────────────────────
export {
  WorkshopContextProvider,
  useWorkshop,
  useActiveSection,
  useVariables,
} from "./context/WorkshopContext";
export {
  TerminalContextProvider,
  useTerminal,
} from "./context/TerminalContext";
export { TabContextProvider, useTabs, CI_TAB_ID } from "./context/TabContext";
export {
  ProgressContextProvider,
  useProgress,
} from "./context/ProgressContext";
export { PrintModeProvider, usePrintMode } from "./context/PrintModeContext";
export {
  PanelWindowProvider,
  usePanelWindow,
} from "./context/PanelWindowContext";

// ── The runtime ────────────────────────────────────────────────────────────
export { Labspace, LabspaceLayout } from "./components/Labspace";

// ── Its panels, for a host composing them itself ───────────────────────────
export { WorkshopPanel } from "./components/WorkshopPanel/WorkshopPanel";
export { TerminalPanel } from "./components/TerminalPanel/TerminalPanel";
export { MarkdownRenderer } from "./components/WorkshopPanel/markdown/MarkdownRenderer";

// ── Shared surfaces ────────────────────────────────────────────────────────
export { LoadingState, ErrorState } from "./components/LoadState";
