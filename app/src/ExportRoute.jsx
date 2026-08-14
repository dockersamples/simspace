import "./App.scss";
import { ToastContainer } from "react-toastify";
import {
  TabContextProvider,
  TerminalContextProvider,
  PrintModeProvider,
} from "@dockersamples/simspace-labspace";
import { ExportView } from "./components/ExportView/ExportView";
import { LabRoute } from "./labspace/LabRoute";

function ExportRoute() {
  return (
    <>
      <LabRoute printMode>
        <TabContextProvider>
          <TerminalContextProvider>
            <PrintModeProvider>
              <ExportView />
            </PrintModeProvider>
          </TerminalContextProvider>
        </TabContextProvider>
      </LabRoute>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default ExportRoute;
