import "./App.scss";
import { ToastContainer } from "react-toastify";
import { useParams } from "react-router";
import { WorkshopContextProvider } from "./WorkshopContext";
import { TabContextProvider } from "./TabContext";
import { TerminalContextProvider } from "./context/TerminalContext";
import { TrackingContextProvider } from "./context/TrackingContext";
import { DeckContextProvider } from "./context/DeckContext";
import { DeckView } from "./components/Deck/DeckView";

// Runs a `kind: slides` catalog entry as a slide deck.
//
// The provider stack is the SAME as a lab's (AppRoute), minus the panel-window
// wrapper the split layout needs: Workshop loads the manifest, Tab resolves
// terminal ids, Terminal owns the one shared Simulator, Tracking records
// progress. None of them knew anything about a two-pane layout, so a deck reuses
// all of it and only the view differs — which is why this file is short.
//
// DeckContext sits ABOVE Tracking on purpose: the tracking layer reports the
// current slide, so it has to be able to read the deck's position. That keeps all
// of the reporting logic in the tracking layer instead of scattering emit calls
// through the view.
function DeckRoute() {
  // Remount the provider tree when the entry changes so its simulator and
  // terminals reinitialize instead of leaking state from the previous entry.
  const { labId } = useParams();
  return (
    <>
      <WorkshopContextProvider key={labId ?? "default"}>
        <TabContextProvider>
          <TerminalContextProvider>
            <DeckContextProvider>
              <TrackingContextProvider>
                <DeckView />
              </TrackingContextProvider>
            </DeckContextProvider>
          </TerminalContextProvider>
        </TabContextProvider>
      </WorkshopContextProvider>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default DeckRoute;
