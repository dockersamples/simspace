// The pulse adapter for the lab currently loaded, or undefined when tracking is
// off for this deployment or this lab.
//
// Must be called inside the workshop provider: the lab's `tracking:` directive
// comes from its own labspace.yaml, merged over the deployment default in
// config.json. Returning undefined (rather than a disabled adapter) is what
// makes the runtime fall back to its no-op — local progress still works and
// nothing goes over the wire.

import { useMemo } from "react";
import { resolveTracking, useWorkshop } from "@dockersamples/simspace-labspace";
import { useAppConfig } from "../context/AppConfigContext";
import { createPulseAnalytics } from "./pulseAnalytics";

export function usePulseAnalytics() {
  const workshop = useWorkshop();
  const appConfig = useAppConfig();

  return useMemo(() => {
    const resolved = resolveTracking(
      appConfig?.tracking,
      workshop.tracking,
      workshop.labKey || "",
    );
    return createPulseAnalytics(resolved) || undefined;
  }, [appConfig, workshop.tracking, workshop.labKey]);
}
