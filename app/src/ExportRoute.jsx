import "./App.scss";
import { ToastContainer } from "react-toastify";
import { WorkshopContextProvider } from "./WorkshopContext";
import { TabContextProvider } from "./TabContext";
import { TerminalContextProvider } from "./context/TerminalContext";
import { PrintModeProvider } from "./PrintModeContext";
import { ExportView } from "./components/ExportView/ExportView";

function ExportRoute() {
  return (
    <>
      <WorkshopContextProvider printMode>
        <TabContextProvider>
          <TerminalContextProvider>
            <PrintModeProvider>
              <ExportView />
            </PrintModeProvider>
          </TerminalContextProvider>
        </TabContextProvider>
      </WorkshopContextProvider>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default ExportRoute;
