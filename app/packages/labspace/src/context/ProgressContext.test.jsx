// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkshopContextProvider } from "./WorkshopContext.jsx";
import { TerminalContextProvider } from "./TerminalContext.jsx";
import { ProgressContextProvider, useProgress } from "./ProgressContext.jsx";
import { useTerminal } from "./TerminalContext.jsx";

// The analytics SEAM, which is the promise this package makes to a host: a
// runtime embedded in someone else's page reports nothing anywhere until that
// page hands it an adapter.
//
// This is the one React test in the package, and it earns the exception because
// the guarantee is invisible on screen — a leak looks like nothing at all until
// it turns up in a browser's network tab on docs.docker.com. The rest of the UI
// is verified by running it (see AGENTS.md), and by embed.html.

const CONFIG = {
  title: "Demo",
  baseUrl: "https://example.test/labs/demo/",
  sections: [
    {
      id: "intro",
      title: "Intro",
      baseUrl: "https://example.test/labs/demo/",
      contentRaw: "",
      slides: [],
      steps: [{ id: "step-1", title: "One" }],
    },
  ],
  services: [],
  variables: {},
  files: {},
  terminals: [{ id: "terminal", title: "Terminal", icon: "terminal" }],
  features: {},
  tracking: null,
  version: null,
  simulatorSpec: "version: 2\nscenarios: []\n",
};

/** Reports what the runtime recorded, and lets a test fire a terminal event. */
function Probe() {
  const progress = useProgress();
  const { broadcast } = useTerminal();
  globalThis.__broadcast = broadcast;
  return (
    <div data-testid="probe">
      {progress.isStepComplete("step-1") ? "done" : "not-done"}
    </div>
  );
}

function mount(analytics) {
  return render(
    <WorkshopContextProvider config={CONFIG} labKey="test-lab">
      <TerminalContextProvider>
        <ProgressContextProvider analytics={analytics}>
          <Probe />
        </ProgressContextProvider>
      </TerminalContextProvider>
    </WorkshopContextProvider>,
  );
}

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});
afterEach(() => {
  // Each case mounts its own tree; without this they pile up in one document
  // and every query finds several.
  cleanup();
  delete globalThis.__broadcast;
  vi.restoreAllMocks();
});

describe("the analytics seam", () => {
  it("sends nothing anywhere when the host supplies no adapter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({});
    const beacon = vi.fn(() => true);
    navigator.sendBeacon = beacon;

    mount(undefined);
    await act(async () => {
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("still records local progress with no adapter", async () => {
    mount(undefined);
    expect(screen.getByTestId("probe")).toHaveTextContent("not-done");

    await act(async () => {
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
    });

    // The check-marks are NOT part of the optional layer. Swapping the whole
    // tracking context for a no-op would have taken them with it.
    expect(screen.getByTestId("probe")).toHaveTextContent("done");
  });

  it("reports the events a host's adapter expects", async () => {
    const track = vi.fn();

    mount({ track });
    await act(async () => {
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
    });

    const events = track.mock.calls.map(([event]) => event);
    expect(events).toContain("lab_started");
    expect(events).toContain("section_viewed");
    expect(events).toContain("step_completed");
    // The lab's only step just completed, so the lab is finished.
    expect(events).toContain("lab_completed");
  });

  it("stamps every event with the lab and the learner's session", async () => {
    const track = vi.fn();

    mount({ track });

    const [, payload] = track.mock.calls[0];
    expect(payload.labId).toBe("test-lab");
    expect(payload.sessionId).toEqual(expect.any(String));
    expect(payload.avatar).toMatchObject({ emoji: expect.any(String) });
  });

  it("reports a completed step only once", async () => {
    const track = vi.fn();

    mount({ track });
    await act(async () => {
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
    });

    const completions = track.mock.calls.filter(
      ([event]) => event === "step_completed",
    );
    expect(completions).toHaveLength(1);
  });

  it("starts no timer for an adapter that did not ask for a heartbeat", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");

    mount({ track: vi.fn() });

    // An embedded runtime must not leave a timer running in a host's page.
    expect(setInterval).not.toHaveBeenCalled();
  });

  it("survives an adapter that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const track = vi.fn(() => {
      throw new Error("adapter is broken");
    });

    expect(() => mount({ track })).not.toThrow();
    await act(async () => {
      globalThis.__broadcast({ type: "step", stepId: "step-1" });
    });

    // A broken host adapter must not take the lab down with it.
    expect(screen.getByTestId("probe")).toHaveTextContent("done");
  });
});
