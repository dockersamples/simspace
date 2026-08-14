import { useEffect, useRef } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { WorkshopContextProvider } from "../context/WorkshopContext.jsx";
import { TabContextProvider } from "../context/TabContext.jsx";
import { TerminalContextProvider } from "../context/TerminalContext.jsx";
import { ProgressContextProvider } from "../context/ProgressContext.jsx";
import { PanelWindowProvider } from "../context/PanelWindowContext.jsx";
import { useTerminal } from "../context/TerminalContext.jsx";
import { useProgress } from "../context/ProgressContext.jsx";
import { WorkshopPanel } from "./WorkshopPanel/WorkshopPanel.jsx";
import { TerminalPanel } from "./TerminalPanel/TerminalPanel.jsx";
import "./Labspace.scss";

/**
 * Hands the host a handle on the running lab.
 *
 * Renders nothing; it exists to be INSIDE the providers, which is the only place
 * `reset` can be reached from. A host that wants its own reset button — styled to
 * its own page — takes it from here rather than using the built-in one.
 *
 * Note this cannot be used from an `.astro` file: Astro serializes island props
 * and drops functions silently. Pass `onReady` from a React wrapper component.
 */
function ReadyBridge({ onReady }) {
  const { resetAll } = useTerminal();
  const progress = useProgress();
  const resetProgress = progress?.resetProgress;

  // Held in a ref so an inline arrow function from the host doesn't re-fire this
  // on every one of its renders.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    onReadyRef.current?.({ reset: resetAll, resetProgress });
  }, [resetAll, resetProgress]);

  return null;
}

/**
 * The lab itself: instructions on the left, terminals over one shared simulator
 * on the right, plus the CI tab and controls panel when the lab declares them.
 *
 * Expects a loaded labspace above it — <Labspace> is the usual way to get one.
 * Use this directly when the host already owns the workshop provider because it
 * needs to read the loaded lab BEFORE the runtime mounts: this app does, to
 * build its analytics adapter and its offline menu item from the lab's own
 * config. Same layout either way, defined once.
 */
export function LabspaceLayout({
  brand,
  menuItems,
  theme = "auto",
  components,
  analytics,
  positionId,
  wrapTerminal,
  resetButton = true,
  onReady,
  defaultSplit = 50,
  autoSaveId,
  className = "",
}) {
  const terminal = <TerminalPanel showReset={resetButton} />;

  return (
    <TabContextProvider>
      <TerminalContextProvider>
        <ProgressContextProvider analytics={analytics} positionId={positionId}>
          <ReadyBridge onReady={onReady} />
          <PanelWindowProvider>
            <PanelGroup
              direction="horizontal"
              autoSaveId={autoSaveId}
              className={`labspace ${className}`.trim()}
            >
              <Panel
                defaultSize={defaultSplit}
                minSize={20}
                className="labspace-panel"
              >
                <WorkshopPanel
                  brand={brand}
                  menuItems={menuItems}
                  theme={theme}
                  components={components}
                />
              </Panel>
              <PanelResizeHandle className="labspace-resize-handle">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2m-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2"
                  ></path>
                </svg>
              </PanelResizeHandle>
              <Panel
                defaultSize={100 - defaultSplit}
                minSize={20}
                className="labspace-panel"
              >
                {wrapTerminal ? wrapTerminal(terminal) : terminal}
              </Panel>
            </PanelGroup>
          </PanelWindowProvider>
        </ProgressContextProvider>
      </TerminalContextProvider>
    </TabContextProvider>
  );
}

/**
 * A whole lab, in one component.
 *
 * Give it a labspace and it renders the runtime. It fills its container and sets
 * no page-level styles, so the host decides how big the lab is and what
 * surrounds it:
 *
 *   <div style={{ height: "80vh" }}>
 *     <Labspace config={resolved} brand={{ logo, eyebrow: "Lab" }} />
 *   </div>
 *
 * ── The lab ────────────────────────────────────────────────────────────────
 *   config         An already-resolved labspace (what loadLabspace returns).
 *                  Prefer this: resolve at build time and the instructions can
 *                  be rendered into the served HTML, with no loading state.
 *   labspaceUrl    …or a labspace.yaml to fetch at mount.
 *   labKey         Namespaces saved progress, variables, engine state, and
 *                  transcripts. Give each lab its own so they can't collide.
 *   loaderOptions  Passed to loadLabspace ({ fetchText, parseSlides }).
 *
 * ── Chrome ─────────────────────────────────────────────────────────────────
 *   brand          Header identity: { logo, eyebrow, backHref }. `false` drops
 *                  the header, for a page that has its own.
 *   menuItems      Extra actions for the header's context menu.
 *   theme          "auto" (default, follows the reader's system setting),
 *                  "light", or "dark". The terminal is always dark.
 *   components     Extra markdown directives for the instructions.
 *
 * ── Behaviour ──────────────────────────────────────────────────────────────
 *   analytics      Where milestone events go. Omitted → nothing leaves the page.
 *   section /      Drive the current section from the host's router. Omit both
 *   onSectionChange  and the runtime navigates itself.
 *   onError        Called if the lab fails to load (it also renders the error).
 *   wrapTerminal   Decorate the terminal pane, e.g. to host it in a pop-out
 *                  window. Receives the pane, returns what to render.
 *   resetButton    Show the built-in "Reset lab" control in the terminal pane's
 *                  tab bar. Default true. Set false only if you provide your own
 *                  via `onReady` — a lab with no way to start over is a dead end.
 *   onReady        Called with `{ reset, resetProgress }` once the lab is
 *                  running, for a host that wants to drive it from its own
 *                  chrome. Like every function prop here, it cannot come from an
 *                  `.astro` file — Astro drops function props silently. Pass it
 *                  from a React wrapper.
 *   defaultSplit   Instructions width as a percentage. Default 50.
 *   autoSaveId     Persist the reader's split position under this key.
 */
export function Labspace({
  config,
  labspaceUrl,
  labKey = "",
  loaderOptions,
  section,
  onSectionChange,
  onError,
  className,
  ...layout
}) {
  return (
    <WorkshopContextProvider
      config={config}
      labspaceUrl={labspaceUrl}
      labKey={labKey}
      loaderOptions={loaderOptions}
      section={section}
      onSectionChange={onSectionChange}
      onError={onError}
      className={className}
    >
      <LabspaceLayout {...layout} className={className} />
    </WorkshopContextProvider>
  );
}
