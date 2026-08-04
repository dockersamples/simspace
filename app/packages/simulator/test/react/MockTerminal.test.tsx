// @vitest-environment jsdom

import { createRef } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "../../src/index";
import {
  MockTerminal,
  SimTerminal,
  type MockTerminalHandle,
} from "../../src/react/index";

const SPEC = `
version: "2.0"
metadata:
  title: "Demo"
  summary: "A fixture lab"
settings:
  streaming: false
scenarios:
  - id: ps
    when: { command: "docker ps" }
    then:
      output: ["CONTAINER ID", "abc123 nginx"]
  - id: columns
    when: { command: "docker images" }
    then:
      output: ["REPOSITORY     TAG"]
`;

/** Types a line into the terminal through its imperative handle. */
async function runLine(handle: MockTerminalHandle | null, line: string) {
  await act(async () => {
    handle!.runCommand(line);
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  // Vitest is configured without globals, so @testing-library's auto-cleanup
  // afterEach is never registered — without this, renders accumulate in the
  // document and queries start matching elements from previous tests.
  cleanup();
  localStorage.clear();
});

describe("MockTerminal rendering", () => {
  it("greets with the lab's title and summary", () => {
    render(<MockTerminal simulator={new Simulator({ spec: SPEC })} />);
    expect(screen.getByText("Demo")).toBeDefined();
    expect(screen.getByText("A fixture lab")).toBeDefined();
    expect(screen.getByText("Type a command to begin.")).toBeDefined();
  });

  it("accepts a custom greeting, and an empty one suppresses it", () => {
    const { unmount } = render(
      <MockTerminal
        simulator={new Simulator({ spec: SPEC })}
        greeting={["hi"]}
      />,
    );
    expect(screen.getByText("hi")).toBeDefined();
    expect(screen.queryByText("Type a command to begin.")).toBeNull();
    unmount();

    render(
      <MockTerminal simulator={new Simulator({ spec: SPEC })} greeting={[]} />,
    );
    expect(screen.queryByText("Type a command to begin.")).toBeNull();
  });

  it("renders a build error in place instead of throwing", () => {
    render(<MockTerminal simulator={null} error="spec is broken" />);
    expect(
      screen.getByText(/Failed to load lab: spec is broken/),
    ).toBeDefined();
  });

  it("exposes an input with an accessible label", () => {
    render(<MockTerminal simulator={new Simulator({ spec: SPEC })} />);
    expect(screen.getByLabelText("terminal input")).toBeDefined();
  });
});

describe("MockTerminal command execution", () => {
  it("echoes the typed line with the prompt and streams the output", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal ref={ref} simulator={new Simulator({ spec: SPEC })} />,
    );

    await runLine(ref.current, "docker ps");

    expect(screen.getByText("$ docker ps")).toBeDefined();
    expect(screen.getByText("CONTAINER ID")).toBeDefined();
    expect(screen.getByText("abc123 nginx")).toBeDefined();
  });

  it("preserves column whitespace in output", async () => {
    // Terminal output is column-aligned with runs of spaces; the line must land
    // in the DOM verbatim (CSS `white-space: pre-wrap` renders it).
    const ref = createRef<MockTerminalHandle>();
    const { container } = render(
      <MockTerminal ref={ref} simulator={new Simulator({ spec: SPEC })} />,
    );

    await runLine(ref.current, "docker images");

    const texts = [...container.querySelectorAll(".term-stdout")].map(
      (el) => el.textContent,
    );
    expect(texts).toContain("REPOSITORY     TAG");
  });

  it("uses a custom shell prompt in the echo", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal
        ref={ref}
        simulator={new Simulator({ spec: SPEC })}
        shellPrompt="➜ "
      />,
    );
    await runLine(ref.current, "docker ps");
    expect(screen.getByText("➜ docker ps")).toBeDefined();
  });

  it("reports an unmatched command as an error", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal ref={ref} simulator={new Simulator({ spec: SPEC })} />,
    );
    await runLine(ref.current, "kubectl get pods");
    expect(
      screen.getByText(/this command is not simulated in this lab/),
    ).toBeDefined();
  });

  it("clears the transcript on `clear` without touching lab state", async () => {
    const ref = createRef<MockTerminalHandle>();
    const simulator = new Simulator({ spec: SPEC });
    render(<MockTerminal ref={ref} simulator={simulator} />);

    await runLine(ref.current, "docker ps");
    await runLine(ref.current, "clear");

    expect(screen.queryByText("CONTAINER ID")).toBeNull();
    // History survives, proving `clear` is a view-level built-in.
    expect(simulator.getState("history")).toEqual(["docker ps"]);
  });

  it("writes a file through the imperative saveFile handle", async () => {
    const ref = createRef<MockTerminalHandle>();
    const simulator = new Simulator({ spec: SPEC });
    render(<MockTerminal ref={ref} simulator={simulator} />);

    await act(async () => {
      ref.current!.saveFile("notes.md", "written from the panel");
    });

    expect(simulator.files()["notes.md"]).toBe("written from the panel");
    expect(screen.getByText("↳ saved notes.md")).toBeDefined();
  });

  it("notifies the host when a command completes a tracked step", async () => {
    const onChange = vi.fn();
    const ref = createRef<MockTerminalHandle>();
    const simulator = new Simulator({
      spec: `
version: "2.0"
settings: { streaming: false }
scenarios:
  - id: run
    completes: start-container
    when: { command: "docker run" }
    then: { output: ["started"] }
`,
    });
    render(
      <MockTerminal
        ref={ref}
        simulator={simulator}
        terminalId="host"
        onChange={onChange}
      />,
    );

    await runLine(ref.current, "docker run");

    expect(onChange).toHaveBeenCalledWith({
      completes: "start-container",
      matched: "run",
      line: "docker run",
      terminalId: "host",
    });
  });

  it("notifies with no details when the command completed no step", async () => {
    const onChange = vi.fn();
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal
        ref={ref}
        simulator={new Simulator({ spec: SPEC })}
        onChange={onChange}
      />,
    );
    await runLine(ref.current, "docker ps");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe("MockTerminal persistence", () => {
  // The behaviour this refactor introduced: persistence is opt-in via an
  // explicit key, so an embedded terminal on a docs page starts clean.
  it("persists nothing by default", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal ref={ref} simulator={new Simulator({ spec: SPEC })} />,
    );

    await runLine(ref.current, "docker ps");

    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it("starts from the greeting on every mount when no key is given", async () => {
    const first = createRef<MockTerminalHandle>();
    const { unmount } = render(
      <MockTerminal ref={first} simulator={new Simulator({ spec: SPEC })} />,
    );
    await runLine(first.current, "docker ps");
    unmount();

    render(<MockTerminal simulator={new Simulator({ spec: SPEC })} />);
    expect(screen.queryByText("$ docker ps")).toBeNull();
    expect(screen.getByText("Type a command to begin.")).toBeDefined();
  });

  it("saves the transcript under an explicit key", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal
        ref={ref}
        simulator={new Simulator({ spec: SPEC })}
        storageKey="demo:terminal"
      />,
    );

    await runLine(ref.current, "docker ps");

    await waitFor(() =>
      expect(localStorage.getItem("demo:terminal")).toBeTruthy(),
    );
    const saved = JSON.parse(localStorage.getItem("demo:terminal")!);
    expect(saved.history).toEqual(["docker ps"]);
    expect(saved.lines.map((l: { text: string }) => l.text)).toContain(
      "$ docker ps",
    );
  });

  it("restores the transcript on remount, skipping the greeting", async () => {
    const ref = createRef<MockTerminalHandle>();
    const { unmount } = render(
      <MockTerminal
        ref={ref}
        simulator={new Simulator({ spec: SPEC })}
        storageKey="demo:terminal"
      />,
    );
    await runLine(ref.current, "docker ps");
    unmount();

    render(
      <MockTerminal
        simulator={new Simulator({ spec: SPEC })}
        storageKey="demo:terminal"
      />,
    );
    expect(screen.getByText("$ docker ps")).toBeDefined();
    expect(screen.getByText("abc123 nginx")).toBeDefined();
  });

  it("keeps separate keys separate", async () => {
    const a = createRef<MockTerminalHandle>();
    const { unmount } = render(
      <MockTerminal
        ref={a}
        simulator={new Simulator({ spec: SPEC })}
        storageKey="lab-a:terminal"
      />,
    );
    await runLine(a.current, "docker ps");
    unmount();

    render(
      <MockTerminal
        simulator={new Simulator({ spec: SPEC })}
        storageKey="lab-b:terminal"
      />,
    );
    expect(screen.queryByText("$ docker ps")).toBeNull();
  });

  it("survives a storage write failure", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const ref = createRef<MockTerminalHandle>();
    render(
      <MockTerminal
        ref={ref}
        simulator={new Simulator({ spec: SPEC })}
        storageKey="demo:terminal"
      />,
    );

    // A full or unavailable localStorage must not break the terminal.
    await runLine(ref.current, "docker ps");
    expect(screen.getByText("abc123 nginx")).toBeDefined();

    setItem.mockRestore();
  });
});

describe("SimTerminal", () => {
  it("builds its own simulator from a spec string", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(<SimTerminal ref={ref} spec={SPEC} />);

    await runLine(ref.current, "docker ps");

    expect(screen.getByText("abc123 nginx")).toBeDefined();
  });

  it("seeds the virtual filesystem so built-ins see the files", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(
      <SimTerminal ref={ref} spec={SPEC} files={{ "a.txt": "seeded\n" }} />,
    );

    await runLine(ref.current, "ls");

    expect(screen.getByText("a.txt")).toBeDefined();
  });

  it("renders a bad spec as an error rather than throwing", () => {
    // An unparseable demo must not take down the page embedding it.
    render(<SimTerminal spec="version: '1.0'\nscenarios: []" />);
    expect(screen.getByText(/Failed to load lab:/)).toBeDefined();
  });

  it("persists nothing by default", async () => {
    const ref = createRef<MockTerminalHandle>();
    render(<SimTerminal ref={ref} spec={SPEC} />);
    await runLine(ref.current, "docker ps");
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});
