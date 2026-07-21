// SbxTerminal renders an in-browser mock terminal driven by a simulator YAML
// spec. Any command defined in the spec can be typed at the shell prompt. A
// scenario with a `session` effect drops the user into an interactive agent
// REPL; inside a session, `!cmd` runs a command scenario.

import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Session } from "../engine/types";
import { Simulator } from "../engine/simulator";
import "./SbxTerminal.css";

/** A cross-terminal event broadcast so peers can refresh shared UI. */
export interface TerminalEvent {
  type: "state" | "reset";
}

/** Imperative API for driving the terminal from outside (Run / Save buttons). */
export interface SbxTerminalHandle {
  /** Runs a command line as if it were typed at the prompt. */
  runCommand: (text: string) => void;
  /** Writes content to a path in the virtual filesystem. */
  saveFile: (path: string, content: string) => void;
}

export interface SbxTerminalProps {
  /** The shared simulator instance backing every terminal. */
  simulator: Simulator | null;
  /** A build/parse error for the shared simulator, if any. */
  error?: string | null;
  /** This terminal's id — passed to the engine for `when.terminal` matching. */
  terminalId?: string;
  /** Shell prompt shown in command mode. Defaults to "$ ". */
  shellPrompt?: string;
  /** Override streaming; defaults to the lab's `settings.streaming`. */
  streaming?: boolean;
  /** Override per-line stream delay (ms); defaults to the lab's setting. */
  streamDelayMs?: number;
  /** Override agent "Evaluating…" spinner duration (ms); 0 disables it. */
  agentThinkMs?: number;
  /** Extra lines printed once on start (dim). Set to [] to suppress the default. */
  greeting?: string[];
  /** Called after this terminal mutates shared state, so peers can refresh. */
  onChange?: () => void;
  /** Subscribe to cross-terminal events; returns an unsubscribe function. */
  subscribe?: (fn: (event: TerminalEvent) => void) => () => void;
  className?: string;
  style?: React.CSSProperties;
}

type LineKind =
  | "input"
  | "stdout"
  | "stderr"
  | "agent"
  | "system"
  | "think"
  | "whale"
  | "title"
  | "warn"
  | "dim";

interface TermLine {
  id: number;
  text: string;
  kind: LineKind;
}

type Mode = { kind: "command" } | { kind: "session"; sess: Session };

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);

const WHALE = [
  "                  ##         .",
  "            ## ## ##        ==",
  "         ## ## ## ##       ===",
  '     /"""""""""""""""""\\___/ ===',
  "     {                       /  ===-",
  "     \\______ O           __/",
  "       \\    \\         __/",
  "        \\____\\_______/",
];

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SbxTerminal = forwardRef<SbxTerminalHandle, SbxTerminalProps>(
  function SbxTerminal(
    {
      simulator,
      error,
      terminalId,
      shellPrompt = "$ ",
      streaming,
      streamDelayMs,
      agentThinkMs,
      greeting,
      onChange,
      subscribe,
      className,
      style,
    },
    ref,
  ) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const modeRef = useRef<Mode>({ kind: "command" });
  const idRef = useRef(0);
  const history = useRef<string[]>([]);
  const historyPos = useRef<number>(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevBusyRef = useRef(false);
  const completionRef = useRef<{ candidates: string[]; index: number } | null>(null);

  // Effective pacing: prop overrides win, else the lab's resolved settings.
  const opts = simulator?.options ?? { stream: true, delayMs: 20, thinkMs: 700 };
  const stream = streaming ?? opts.stream;
  const delayMs = streamDelayMs ?? opts.delayMs;
  const thinkMs = agentThinkMs ?? opts.thinkMs;

  const nextId = () => ++idRef.current;

  const append = useCallback((text: string, kind: LineKind) => {
    // Bump the counter first so every line gets a unique React key. Reusing
    // idRef.current here would collide with the last emitted line, and the
    // duplicate key makes reconciliation drop/duplicate lines (e.g. the
    // "Evaluating…" spinner rendering twice and one copy surviving removal).
    const id = ++idRef.current;
    setLines((prev) => [...prev, { id, text, kind }]);
  }, []);

  // Reset terminal + simulator whenever a new simulator is built (spec change).
  const greetKey = JSON.stringify(greeting ?? null);
  useEffect(() => {
    modeRef.current = { kind: "command" };
    setLines([]);
    setBusy(false);
    if (!simulator) return;
    const intro =
      greeting ??
      defaultGreeting(simulator.lab.metadata?.title, simulator.lab.metadata?.summary);
    for (const text of intro) {
      const id = ++idRef.current;
      setLines((prev) => [...prev, { id, text, kind: "system" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulator, greetKey]);

  // Keep the newest output in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  // Re-focus the input after a command completes. The focus() call cannot live
  // in the submit() finally block because setBusy(false) only queues a render —
  // the input is still disabled when finally runs, so focus() would be a no-op.
  // This effect fires after React commits the busy=false update, when the input
  // is already re-enabled.
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      inputRef.current?.focus();
    }
    prevBusyRef.current = busy;
  }, [busy]);

  // Stream a list of lines, pausing between them when streaming is enabled.
  const emit = useCallback(
    async (items: { text: string; kind: LineKind }[]) => {
      for (let i = 0; i < items.length; i++) {
        if (stream && delayMs > 0 && i > 0) await sleep(delayMs);
        // Capture the id now, not inside the updater: without a pause between
        // iterations (non-streaming) the updaters run after the loop, so
        // reading idRef.current lazily would give every line the same id.
        const id = ++idRef.current;
        const { text, kind } = items[i];
        setLines((prev) => [...prev, { id, text, kind }]);
      }
    },
    [stream, delayMs],
  );

  // Show the "Evaluating…" spinner briefly before an agent reply, then clear it.
  const think = useCallback(async () => {
    if (!stream || thinkMs <= 0) return;
    const id = nextId();
    setLines((prev) => [
      ...prev,
      { id, text: `${SPINNER[0]} Evaluating...`, kind: "think" },
    ]);
    const interval = 100;
    const steps = Math.max(1, Math.floor(thinkMs / interval));
    for (let i = 0; i < steps; i++) {
      await sleep(interval);
      const frame = SPINNER[i % SPINNER.length];
      setLines((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, text: `${frame} Evaluating...` } : l,
        ),
      );
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, [stream, thinkMs]);

  // Announce that this terminal changed shared state so peers can refresh
  // (e.g. keep every terminal's Settings toggles in sync).
  const notify = useCallback(() => {
    onChange?.();
  }, [onChange]);

  // Render an agent turn: indent non-empty lines and tag stderr distinctly.
  const emitAgentTurn = useCallback(
    async (
      outcome: { lines: { text: string; stream: "stdout" | "stderr" }[] },
    ) => {
      await emit(
        outcome.lines.map((l) => ({
          text: l.text && l.stream === "stdout" ? "  " + l.text : l.text,
          kind: l.stream === "stderr" ? "stderr" : ("agent" as LineKind),
        })),
      );
      await emit([{ text: "", kind: "system" }]); // spacing between turns
    },
    [emit],
  );

  const enterSession = useCallback(
    async (sess: Session) => {
      // Built-in banner so the "this is scripted" disclaimer is always present.
      await emit([
        { text: "", kind: "system" },
        ...WHALE.map((text) => ({ text, kind: "whale" as LineKind })),
        { text: "", kind: "system" },
        { text: "  Simulator · Agent Session", kind: "title" },
        { text: "", kind: "system" },
        {
          text: "  ⚠ Simulated environment — the agent's replies are scripted by",
          kind: "warn",
        },
        {
          text: "    the lab author for teaching. No real model or sandbox is running.",
          kind: "warn",
        },
        { text: "", kind: "system" },
        { text: "  Type /exit or /quit to leave the session.", kind: "dim" },
        { text: "", kind: "system" },
      ]);
      await emit((sess.intro ?? []).map((text) => ({ text, kind: "stdout" as LineKind })));
      modeRef.current = { kind: "session", sess };
    },
    [emit],
  );

  const runCommand = useCallback(
    async (line: string) => {
      if (!simulator) return;
      const outcome = simulator.execute(line, terminalId);
      await emit(
        outcome.lines.map((l) => ({
          text: l.text,
          kind: (l.stream === "stderr" ? "stderr" : "stdout") as LineKind,
        })),
      );
      notify();

      if (outcome.session) {
        // `sbx run -p "…"` runs a single prompt, then exits (no REPL).
        const oneShot = simulator.oneShotPrompt(line);
        if (oneShot !== null) {
          await think();
          const ao = simulator.prompt(oneShot, terminalId);
          await emitAgentTurn(ao);
          notify();
          return;
        }
        await enterSession(outcome.session);
      }
    },
    [simulator, terminalId, emit, think, emitAgentTurn, enterSession, notify],
  );

  const runSessionTurn = useCallback(
    async (line: string, sess: Session) => {
      if (!simulator) return;
      if (EXIT_COMMANDS.has(line)) {
        await emit((sess.outro ?? []).map((text) => ({ text, kind: "stdout" as LineKind })));
        modeRef.current = { kind: "command" };
        return;
      }
      if (line.startsWith("!")) {
        // Shell escape (`!cmd`): run the command text through the normal
        // scenario engine — the same matching used in command mode.
        const cmdOutcome = simulator.execute(line.slice(1), terminalId);
        await emit(
          cmdOutcome.lines.map((l) => ({
            text: l.text,
            kind: (l.stream === "stderr" ? "stderr" : "stdout") as LineKind,
          })),
        );
        notify();
        return;
      }
      await think();
      const ao = simulator.prompt(line, terminalId);
      await emitAgentTurn(ao);
      notify();
    },
    [simulator, terminalId, emit, think, emitAgentTurn, notify],
  );

  // Runs a raw line through the terminal exactly as if it had been typed and
  // submitted. Shared by the Enter handler and the imperative runCommand().
  const runLine = useCallback(
    async (raw: string) => {
      if (busy || !simulator) return;
      const line = raw.trim();

      const mode = modeRef.current;
      const promptPrefix =
        mode.kind === "session" ? sess_prompt(mode.sess) : shellPrompt;

      // Echo the typed line with its prompt, always (even when empty).
      append(promptPrefix + raw, "input");
      if (line) {
        history.current.push(line);
      }
      historyPos.current = -1;

      if (!line) return;

      // `clear` is a terminal built-in (like a shell's clear / Ctrl-L): it wipes
      // the screen without touching lab state, in either command or session mode.
      if (line === "clear") {
        setLines([]);
        return;
      }

      setBusy(true);
      try {
        if (mode.kind === "session") {
          await runSessionTurn(line, mode.sess);
        } else {
          await runCommand(line);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, simulator, shellPrompt, append, runCommand, runSessionTurn],
  );

  const submit = useCallback(async () => {
    const raw = input;
    setInput("");
    await runLine(raw);
  }, [input, runLine]);

  // Persists a code block to the virtual filesystem (Save button). Built-in
  // ls/cat reflect it immediately.
  const saveFile = useCallback(
    (path: string, content: string) => {
      if (!simulator) return;
      try {
        simulator.writeFile(path, content);
        append(`↳ saved ${path}`, "dim");
        notify();
      } catch (e) {
        append((e as Error).message ?? String(e), "stderr");
      }
    },
    [simulator, append, notify],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = history.current;
      if (h.length === 0) return;
      historyPos.current =
        historyPos.current < 0 ? h.length - 1 : Math.max(0, historyPos.current - 1);
      setInput(h[historyPos.current]);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (!simulator) return;
      // On a non-Tab keypress the cycle state is reset (see below); on Tab we
      // either start a new completion or advance through the existing candidates.
      let cycle = completionRef.current;
      if (!cycle) {
        const candidates = tabCandidates(input, simulator);
        if (candidates.length === 0) return;
        cycle = { candidates, index: 0 };
        completionRef.current = cycle;
      } else {
        cycle.index = (cycle.index + 1) % cycle.candidates.length;
      }
      setInput(cycle.candidates[cycle.index]);
      return;
    }
    // Any other key resets the Tab-completion cycle.
    completionRef.current = null;
    if (e.ctrlKey && e.key === "w") {
      e.preventDefault();
      const el = inputRef.current;
      const pos = el?.selectionStart ?? input.length;
      const before = input.slice(0, pos);
      const after = input.slice(pos);
      // Strip trailing whitespace, then strip back to the preceding whitespace.
      const newBefore = before.replace(/\s+$/, "").replace(/\S+$/, "");
      setInput(newBefore + after);
      // Restore cursor to the new position after React re-renders.
      requestAnimationFrame(() => {
        el?.setSelectionRange(newBefore.length, newBefore.length);
      });
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      if (historyPos.current < 0) return;
      if (historyPos.current >= h.length - 1) {
        historyPos.current = -1;
        setInput("");
      } else {
        historyPos.current += 1;
        setInput(h[historyPos.current]);
      }
    }
  };

  // Clears this terminal's transcript and re-greets. The shared machine's state
  // and filesystem are re-seeded once by the context (resetAll), which then
  // broadcasts a "reset" event that lands here — so every terminal's view is
  // rebuilt without each one re-seeding the shared state.
  const resetView = useCallback(() => {
    if (!simulator) return;
    modeRef.current = { kind: "command" };
    idRef.current++;
    const intro =
      greeting ??
      defaultGreeting(simulator.lab.metadata?.title, simulator.lab.metadata?.summary);
    setLines(
      intro.map((text) => ({ id: nextId(), text, kind: "system" as LineKind })),
    );
    inputRef.current?.focus();
  }, [simulator, greeting]);

  // A "reset" from anywhere (the shared machine was re-seeded) rebuilds this
  // terminal's view. Other change events don't affect the transcript.
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type === "reset") resetView();
    });
  }, [subscribe, resetView]);

  useImperativeHandle(
    ref,
    () => ({
      runCommand: (text: string) => void runLine(text),
      saveFile,
    }),
    [runLine, saveFile],
  );

  if (error) {
    return (
      <div className={`sbx-term sbx-term-error ${className ?? ""}`} style={style}>
        <div className="sbx-term-body">
          <div className="term-line term-stderr">
            Failed to load lab: {error}
          </div>
        </div>
      </div>
    );
  }

  const mode = modeRef.current;
  const promptPrefix = mode.kind === "session" ? sess_prompt(mode.sess) : shellPrompt;

  return (
    <div
      className={`sbx-term ${className ?? ""}`}
      style={style}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="sbx-term-body" ref={scrollRef}>
        {lines.map((l) => (
          <div key={l.id} className={`term-line term-${l.kind}`}>
            {l.text === "" ? " " : l.text}
          </div>
        ))}

        <div className="term-line term-inputrow">
          <span className="term-prompt">{promptPrefix}</span>
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="terminal input"
          />
        </div>
      </div>
    </div>
  );
});

function sess_prompt(sess: Session): string {
  return sess.prompt && sess.prompt.length > 0 ? sess.prompt : "> ";
}

/**
 * Returns the list of completions for the current input line. Each candidate
 * is a full replacement for `input` with the last token completed. Directories
 * get a trailing "/" so the next Tab continues into them.
 */
function tabCandidates(input: string, simulator: Simulator): string[] {
  // Split into the prefix (everything before the last token) and the token
  // being completed. We split on whitespace but respect a leading "./".
  const match = input.match(/^(.*\s)?(\S*)$/);
  if (!match) return [];
  const prefix = match[1] ?? "";
  const token = match[2] ?? "";

  // Resolve the directory to list and the basename fragment to filter on.
  const lastSlash = token.lastIndexOf("/");
  const dir = lastSlash < 0 ? "" : token.slice(0, lastSlash);
  const fragment = lastSlash < 0 ? token : token.slice(lastSlash + 1);

  let entries: { name: string; isDir: boolean }[];
  try {
    entries = simulator.listDir(dir);
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.name.startsWith(fragment))
    .map((e) => {
      const completed = (dir ? dir + "/" : "") + e.name + (e.isDir ? "/" : "");
      return prefix + completed;
    });
}

function defaultGreeting(title?: string, summary?: string): string[] {
  const lines: string[] = [];
  if (title) lines.push(title);
  if (summary) lines.push(summary);
  lines.push("Type a command to begin.");
  return lines;
}
