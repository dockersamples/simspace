// This app's lab: the runtime layout, given the app's identity, its pulse
// adapter, and its offline action.
//
// Sits INSIDE the workshop provider (LabRoute) so it can read the loaded lab —
// the `tracking:` directive that configures the adapter, and the section
// markdown the offline cache walks for images. That's the whole reason this app
// composes LabspaceLayout rather than <Labspace>, which owns the provider itself.

import { LabspaceLayout } from "@dockersamples/simspace-labspace";
import { useCatalog } from "../context/CatalogContext";
import { usePulseAnalytics } from "./usePulseAnalytics";
import { useOfflineMenuItem } from "./useOfflineMenuItem";
import { PanelWindow } from "../components/PanelWindow/PanelWindow";

const wrapTerminal = (terminal) => <PanelWindow>{terminal}</PanelWindow>;

export function AppLabspace() {
  const { labs } = useCatalog();
  const offlineItem = useOfflineMenuItem();
  const analytics = usePulseAnalytics();

  // Only offer "back to all labs" when there's actually a catalog to return to
  // (two or more labs). A single lab is entered directly, with no landing page.
  const multiLab = (labs?.length ?? 0) > 1;

  return (
    <LabspaceLayout
      brand={{
        // Relative, like every other asset here, so a subpath deploy works.
        logo: "docker.svg",
        eyebrow: "Labspace",
        backHref: multiLab ? "#/" : undefined,
      }}
      menuItems={offlineItem ? [offlineItem] : []}
      analytics={analytics}
      wrapTerminal={wrapTerminal}
      autoSaveId="persistence"
    />
  );
}
