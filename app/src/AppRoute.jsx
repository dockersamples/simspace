import "./App.scss";
import { ToastContainer } from "react-toastify";
import { LabRoute } from "./labspace/LabRoute";
import { AppLabspace } from "./labspace/AppLabspace";

// A lab, in this app's shell.
//
// The runtime is one component now. What's left here is what an EMBEDDING site
// would also have to bring: routing, and somewhere for this app's own
// notifications to land. That this file is now this short is the point of the
// extraction — the layout, the providers, and the panels are no longer
// duplicated between this app and a host.
function AppRoute() {
  return (
    <>
      <LabRoute>
        <AppLabspace />
      </LabRoute>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default AppRoute;
