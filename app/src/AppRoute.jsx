import "./App.scss";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { ToastContainer } from "react-toastify";
import { useParams } from "react-router";
import { WorkshopPanel } from "./components/WorkshopPanel/WorkshopPanel";
import { WorkshopContextProvider } from "./WorkshopContext";
import { TabContextProvider } from "./TabContext";
import { TerminalContextProvider } from "./context/TerminalContext";
import { TrackingContextProvider } from "./context/TrackingContext";
import { PanelWindowProvider } from "./context/PanelWindowContext";
import { PanelWindow } from "./components/PanelWindow/PanelWindow";
import { TerminalPanel } from "./components/TerminalPanel/TerminalPanel";

function AppRoute() {
  // Remount the whole provider tree when the lab changes so its simulator,
  // variables, and terminals reinitialize cleanly instead of leaking state
  // from the previously loaded lab.
  const { labId } = useParams();
  return (
    <>
      <WorkshopContextProvider key={labId ?? "default"}>
        <TabContextProvider>
          <TerminalContextProvider>
            <TrackingContextProvider>
              <PanelWindowProvider>
                <PanelGroup direction="horizontal" autoSaveId="persistence">
                  <Panel
                    defaultSize={50}
                    minSize={20}
                    className="resizable-panel"
                  >
                    <div className="overflow-auto position-relative">
                      <WorkshopPanel />
                    </div>
                  </Panel>
                  <PanelResizeHandle className="panel-resize-handle">
                    <svg viewBox="0 0 24 24" data-direction="horizontal">
                      <path
                        fill="currentColor"
                        d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2m-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2"
                      ></path>
                    </svg>
                  </PanelResizeHandle>
                  <Panel
                    defaultSize={50}
                    minSize={20}
                    className="resizable-panel d-flex"
                  >
                    <PanelWindow>
                      <TerminalPanel />
                    </PanelWindow>
                  </Panel>
                </PanelGroup>
              </PanelWindowProvider>
            </TrackingContextProvider>
          </TerminalContextProvider>
        </TabContextProvider>
      </WorkshopContextProvider>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default AppRoute;
