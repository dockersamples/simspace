// A batteries-included terminal for the simple case: one terminal, one
// simulator, driven straight from a YAML spec string.
//
//   <SimTerminal spec={yamlText} style={{ height: 320 }} />
//
// This is the entry point for embedding a demo terminal in a docs page, a
// marketing site, or a slide — surfaces that want a scripted terminal and
// nothing else. It owns the Simulator instance so the caller never touches the
// engine API, and it persists nothing by default (see MockTerminal's
// `storageKey`), so a reload restarts the demo.
//
// Reach past this to <MockTerminal> when you need SEVERAL terminals sharing one
// simulator — a shared state tree and virtual filesystem, like two shells on one
// machine. That's what the Labspace lab app does: it builds the Simulator once
// itself and hands the same instance to every terminal. This component
// deliberately can't express that, because one-simulator-per-terminal is the
// right default everywhere else.

import { forwardRef, useMemo } from "react";
import { Simulator } from "../engine/simulator";
import {
  MockTerminal,
  type MockTerminalHandle,
  type MockTerminalProps,
} from "./MockTerminal";

export interface SimTerminalProps extends Omit<
  MockTerminalProps,
  "simulator" | "error"
> {
  /** The simulator YAML spec text (see the `simulator.yaml` specification). */
  spec: string;
  /** Optional seed for the virtual filesystem, keyed by relative path. */
  files?: Record<string, string>;
}

export const SimTerminal = forwardRef<MockTerminalHandle, SimTerminalProps>(
  function SimTerminal({ spec, files, ...rest }, ref) {
    // Rebuild only when the spec or the seed files actually change. Stringifying
    // the seed keeps a fresh object with identical contents from forcing a
    // needless rebuild (which would wipe the transcript).
    const filesKey = JSON.stringify(files ?? {});
    const { simulator, error } = useMemo(() => {
      try {
        return { simulator: new Simulator({ spec, files }), error: null };
      } catch (e) {
        // A bad spec is an authoring mistake, and the terminal renders it in
        // place rather than throwing — an unparseable demo shouldn't take down
        // the page that embeds it.
        return { simulator: null, error: (e as Error).message };
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec, filesKey]);

    return (
      <MockTerminal ref={ref} simulator={simulator} error={error} {...rest} />
    );
  },
);
