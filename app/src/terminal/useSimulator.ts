// A thin React hook that builds and memoizes a Simulator from the spec YAML.
// Rebuilds only when the spec or seed files change; surfaces parse / schema
// errors instead of throwing during render.

import { useMemo } from "react";
import { Simulator } from "../engine/simulator";

export interface UseSimulatorResult {
  simulator: Simulator | null;
  /** A parse/schema error message, if the spec could not be loaded. */
  error: string | null;
}

export function useSimulator(
  spec: string,
  files?: Record<string, string>,
): UseSimulatorResult {
  // Seed files rarely change identity; stringify so a new object with the same
  // contents does not force a needless rebuild.
  const filesKey = JSON.stringify(files ?? {});

  return useMemo(() => {
    try {
      const simulator = new Simulator({ spec, files: files ?? {} });
      return { simulator, error: null };
    } catch (e) {
      return { simulator: null, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, filesKey]);
}
