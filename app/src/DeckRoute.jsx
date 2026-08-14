import "./App.scss";
import { ToastContainer } from "react-toastify";
import {
  TabContextProvider,
  TerminalContextProvider,
} from "@dockersamples/simspace-labspace";
import { DeckContextProvider } from "./context/DeckContext";
import { DeckView } from "./components/Deck/DeckView";
import { LabRoute } from "./labspace/LabRoute";
import { DeckProgress } from "./labspace/DeckProgress";

// Runs a `kind: slides` catalog entry as a slide deck.
//
// The provider stack is the SAME as a lab's (AppRoute), minus the panel-window
// wrapper the split layout needs: Workshop loads the manifest, Tab resolves
// terminal ids, Terminal owns the one shared Simulator, Progress records
// milestones. None of them knew anything about a two-pane layout, so a deck
// reuses all of it and only the view differs — which is why this file is short.
//
// DeckContext sits ABOVE the progress layer on purpose: the deck's position is
// what gets reported, so it has to be readable from there. That keeps the
// reporting logic in one place instead of scattering emit calls through the view.
function DeckRoute() {
  return (
    <>
      <LabRoute>
        <TabContextProvider>
          <TerminalContextProvider>
            <DeckContextProvider>
              <DeckProgress>
                <DeckView />
              </DeckProgress>
            </DeckContextProvider>
          </TerminalContextProvider>
        </TabContextProvider>
      </LabRoute>
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default DeckRoute;
