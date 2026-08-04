// MockTerminal renders an in-browser mock terminal driven by a simulator YAML
// spec. Any command defined in the spec can be typed at the shell prompt. A
// scenario with a `session` effect drops the user into an interactive agent
// REPL; inside a session, `!cmd` runs a command scenario. A scenario with an
// `input` effect (§7.5) instead collects one or more values (masking secrets),
// then applies the request's resolution `then` — see the "input" Mode below.

import {
  KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { InputRequest, Session } from "../engine/types";
import { Simulator, type AgentOutcome } from "../engine/simulator";
import "./MockTerminal.css";

/** A cross-terminal event broadcast so peers can refresh shared UI. */
export interface TerminalEvent {
  type: "state" | "reset";
}

/** Imperative API for driving the terminal from outside (Run / Save buttons). */
export interface MockTerminalHandle {
  /** Runs a command line as if it were typed at the prompt. */
  runCommand: (text: string) => void;
  /** Writes content to a path in the virtual filesystem. */
  saveFile: (path: string, content: string) => void;
}

/**
 * Details of a terminal change reported to `onChange`. Present only when the
 * command completed a tracked step (`completes` set); otherwise `onChange` is
 * called with `undefined` (a bare "shared state changed" signal).
 */
export interface TerminalChange {
  /** The step id the command completed (from the scenario's `completes:`). */
  completes: string;
  /** The matched scenario id (`Result.matched`). */
  matched?: string;
  /** The command line that fired the step. */
  line?: string;
  /** The terminal the command came from. */
  terminalId?: string;
}

export interface MockTerminalProps {
  /** The shared simulator instance backing every terminal. */
  simulator: Simulator | null;
  /** A build/parse error for the shared simulator, if any. */
  error?: string | null;
  /** This terminal's id — passed to the engine for `when.terminal` matching. */
  terminalId?: string;
  /**
   * `localStorage` key under which this terminal's transcript, prompt mode, and
   * history are saved and restored across reloads.
   *
   * Omit it (the default) and the terminal keeps nothing: every mount starts
   * from the greeting. That's what an embedded terminal on a docs or marketing
   * page wants — a reload should reset the demo, not resume a stranger's
   * half-finished session. Callers that DO want persistence own the whole key,
   * so they can namespace it however suits them (a lab passes something like
   * `simspace:terminal:host:tour-of-docker`).
   */
  storageKey?: string | null;
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
  /**
   * Called after this terminal runs a command, so peers can refresh shared
   * state. When the command completed a tracked step, the `info` argument
   * carries the step id (and matched scenario / command line); otherwise it is
   * called with `undefined`.
   */
  onChange?: (info?: TerminalChange) => void;
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

/**
 * One item queued for streaming by `emit`. `delayMs` overrides the default
 * per-line cadence (carried from the engine's output pacing); `pause` marks a
 * wait-only item that renders no line.
 */
interface EmitItem {
  text: string;
  kind: LineKind;
  delayMs?: number;
  pause?: boolean;
}

/**
 * The opening command's tracking details, carried into input mode so the
 * scenario's `completes` fires when the value is submitted (the "learner did
 * it" moment), not when the prompt merely opens.
 */
interface InputOpen {
  completes?: string;
  matched?: string;
  line?: string;
  /** The opening command's captured args, passed back into submitInput. */
  args?: Record<string, string>;
}

type Mode =
  | { kind: "command" }
  | { kind: "session"; sess: Session }
  | {
      kind: "input";
      req: InputRequest;
      stepIndex: number;
      values: Record<string, string>;
      open: InputOpen;
    };

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);
/** Lines that abort an in-progress interactive input and return to the shell. */
const INPUT_ABORT = new Set(["/cancel", "/exit", "/quit"]);

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

export const MockTerminal = forwardRef<MockTerminalHandle, MockTerminalProps>(
  function MockTerminal(
    {
      simulator,
      error,
      terminalId,
      storageKey,
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
    const savedSession = useMemo(() => {
      if (!storageKey) return null;
      try {
        const raw = localStorage.getItem(storageKey);
        return raw
          ? (JSON.parse(raw) as {
              lines: TermLine[];
              mode: Mode;
              history: string[];
            })
          : null;
      } catch {
        return null;
      }
    }, [storageKey]);

    const [lines, setLines] = useState<TermLine[]>(() =>
      Array.isArray(savedSession?.lines) ? savedSession.lines : [],
    );
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<Mode>(
      () => (savedSession?.mode as Mode) ?? { kind: "command" },
    );

    const modeRef = useRef<Mode>(mode);
    const idRef = useRef(lines.reduce((max, l) => Math.max(max, l.id), 0));
    const history = useRef<string[]>(
      Array.isArray(savedSession?.history) ? savedSession.history : [],
    );
    const historyPos = useRef<number>(-1);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const prevBusyRef = useRef(false);
    const completionRef = useRef<{
      candidates: string[];
      index: number;
    } | null>(null);

    // Effective pacing: prop overrides win, else the lab's resolved settings.
    const opts = simulator?.options ?? {
      stream: true,
      delayMs: 20,
      thinkMs: 700,
    };
    const stream = streaming ?? opts.stream;
    const delayMs = streamDelayMs ?? opts.delayMs;
    const thinkMs = agentThinkMs ?? opts.thinkMs;

    const nextId = () => ++idRef.current;

    // Tracks the (simulator, greetKey) pair last handled by the greeting effect.
    // Pre-filled when restoring from storage so the initial mount skips the greeting.
    // Idempotent: StrictMode's double-invocation sees the same pair both times and
    // skips; a genuine simulator change presents a new object and triggers a reset.
    const greetKey = JSON.stringify(greeting ?? null);
    const greetedRef = useRef<{ sim: typeof simulator; key: string } | null>(
      savedSession !== null ? { sim: simulator, key: greetKey } : null,
    );

    const append = useCallback((text: string, kind: LineKind) => {
      // Bump the counter first so every line gets a unique React key. Reusing
      // idRef.current here would collide with the last emitted line, and the
      // duplicate key makes reconciliation drop/duplicate lines (e.g. the
      // "Evaluating…" spinner rendering twice and one copy surviving removal).
      const id = ++idRef.current;
      setLines((prev) => [...prev, { id, text, kind }]);
    }, []);

    // Reset terminal + simulator whenever a new simulator is built (spec change).
    // Skipped on mount when we restored a saved session (greetedRef pre-filled).
    useEffect(() => {
      if (
        greetedRef.current?.sim === simulator &&
        greetedRef.current?.key === greetKey
      ) {
        return;
      }
      greetedRef.current = { sim: simulator, key: greetKey };
      modeRef.current = { kind: "command" };
      setMode({ kind: "command" });
      setLines([]);
      setBusy(false);
      if (!simulator) return;
      const intro =
        greeting ??
        defaultGreeting(
          simulator.lab.metadata?.title,
          simulator.lab.metadata?.summary,
        );
      for (const text of intro) {
        const id = ++idRef.current;
        setLines((prev) => [...prev, { id, text, kind: "system" }]);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [simulator, greetKey]);

    // Persist the terminal session (lines, mode, history) to localStorage so a
    // page refresh restores the exact transcript and prompt state.
    useEffect(() => {
      if (!storageKey) return;
      try {
        // Never persist an in-progress input: its collected values may include a
        // masked secret. A refresh mid-input drops back to the command prompt.
        const persistMode: Mode =
          mode.kind === "input" ? { kind: "command" } : mode;
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            lines,
            mode: persistMode,
            history: history.current,
          }),
        );
      } catch {
        /* storage full or unavailable */
      }
    }, [storageKey, lines, mode]);

    // Keep the newest output in view. A layout effect scrolls synchronously
    // before the browser paints, so streamed lines never flash in below the fold
    // and then jump. `busy` is a dependency too: when the input row appears or
    // disappears the body's height changes, and we want to stay pinned to the
    // bottom without waiting for the focus() scroll.
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [lines, busy]);

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
    // A line's own `delayMs` (from the engine's output pacing) overrides the
    // default per-line cadence; a `pause` line contributes only its wait and
    // renders nothing. All delays collapse to 0 when streaming is off, so pacing
    // stays purely cosmetic.
    const emit = useCallback(
      async (items: EmitItem[]) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (stream) {
            const wait =
              item.delayMs != null ? item.delayMs : i > 0 ? delayMs : 0;
            if (wait > 0) await sleep(wait);
          }
          if (item.pause) continue; // a pure pause: waited above, render nothing
          // Capture the id now, not inside the updater: without a pause between
          // iterations (non-streaming) the updaters run after the loop, so
          // reading idRef.current lazily would give every line the same id.
          const id = ++idRef.current;
          const { text, kind } = item;
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
    const notify = useCallback(
      (outcome?: { completes?: string; matched?: string }, line?: string) => {
        onChange?.(
          outcome?.completes
            ? {
                completes: outcome.completes,
                matched: outcome.matched,
                line,
                terminalId,
              }
            : undefined,
        );
      },
      [onChange, terminalId],
    );

    // Render an agent turn: indent non-empty lines and tag stderr distinctly.
    // Takes the engine's AgentOutcome rather than a hand-written line shape, so
    // the pacing fields (delayMs/pause) it carries stay part of the contract.
    const emitAgentTurn = useCallback(
      async (outcome: AgentOutcome) => {
        await emit(
          outcome.lines.map((l) => ({
            text: l.text && l.stream === "stdout" ? "  " + l.text : l.text,
            kind: l.stream === "stderr" ? "stderr" : ("agent" as LineKind),
            delayMs: l.delayMs,
            pause: l.pause,
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
        await emit(
          (sess.intro ?? []).map((text) => ({
            text,
            kind: "stdout" as LineKind,
          })),
        );
        modeRef.current = { kind: "session", sess };
        setMode({ kind: "session", sess });
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
            delayMs: l.delayMs,
            pause: l.pause,
          })),
        );

        if (outcome.input) {
          // Enter interactive input collection. Completion is deferred to the
          // submit (see runInputTurn), so we don't notify here.
          const next: Mode = {
            kind: "input",
            req: outcome.input,
            stepIndex: 0,
            values: {},
            open: {
              completes: outcome.completes,
              matched: outcome.matched,
              line,
              args: outcome.inputArgs,
            },
          };
          modeRef.current = next;
          setMode(next);
          return;
        }

        notify(outcome, line);

        if (outcome.session) {
          // A one-shot prompt (e.g. `run -p "…"`) runs a single prompt, then exits (no REPL).
          const oneShot = simulator.oneShotPrompt(line);
          if (oneShot !== null) {
            await think();
            const ao = simulator.prompt(oneShot, terminalId);
            await emitAgentTurn(ao);
            notify(ao, line);
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
          await emit(
            (sess.outro ?? []).map((text) => ({
              text,
              kind: "stdout" as LineKind,
            })),
          );
          modeRef.current = { kind: "command" };
          setMode({ kind: "command" });
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
              delayMs: l.delayMs,
              pause: l.pause,
            })),
          );
          notify(cmdOutcome, line.slice(1));
          return;
        }
        await think();
        const ao = simulator.prompt(line, terminalId);
        await emitAgentTurn(ao);
        notify(ao, line);
      },
      [simulator, terminalId, emit, think, emitAgentTurn, notify],
    );

    // Handles one line typed while collecting interactive input. Stores the
    // value under the current step's key and advances; on the final step it
    // resolves the request through the engine and returns to the shell. Abort
    // words (/cancel, /exit, /quit) leave input mode without applying effects.
    const runInputTurn = useCallback(
      async (value: string, current: Extract<Mode, { kind: "input" }>) => {
        if (!simulator) return;
        if (INPUT_ABORT.has(value)) {
          await emit([{ text: "(input cancelled)", kind: "dim" as LineKind }]);
          modeRef.current = { kind: "command" };
          setMode({ kind: "command" });
          return;
        }

        const step = current.req.steps[current.stepIndex];
        const values = { ...current.values, [step.key]: value };
        const nextIndex = current.stepIndex + 1;

        if (nextIndex < current.req.steps.length) {
          // More questions to ask — advance to the next step's prompt.
          const next: Mode = { ...current, stepIndex: nextIndex, values };
          modeRef.current = next;
          setMode(next);
          return;
        }

        // All values collected: leave input mode, then apply the resolution.
        modeRef.current = { kind: "command" };
        setMode({ kind: "command" });
        const outcome = simulator.submitInput(
          current.req,
          values,
          current.open.args,
        );
        await emit(
          outcome.lines.map((l) => ({
            text: l.text,
            kind: (l.stream === "stderr" ? "stderr" : "stdout") as LineKind,
            delayMs: l.delayMs,
            pause: l.pause,
          })),
        );
        // Fire the opening scenario's deferred completion now that the learner
        // finished the interaction. When it had no `completes`, this is a bare
        // "shared state changed" signal (submitInput may have mutated state).
        notify(
          { completes: current.open.completes, matched: current.open.matched },
          current.open.line,
        );
      },
      [simulator, emit, notify],
    );

    // Runs a raw line through the terminal exactly as if it had been typed and
    // submitted. Shared by the Enter handler and the imperative runCommand().
    const runLine = useCallback(
      async (raw: string) => {
        if (busy || !simulator) return;
        const line = raw.trim();

        const currentMode = modeRef.current;
        const inInput = currentMode.kind === "input";
        const masked =
          inInput && !!currentMode.req.steps[currentMode.stepIndex].mask;
        const promptPrefix = promptFor(currentMode, shellPrompt);

        // Echo the typed line with its prompt, always (even when empty). A masked
        // step echoes bullets so the secret never lands in the transcript (or the
        // persisted lines) as plaintext.
        const echo = masked ? "•".repeat(raw.length) : raw;
        append(promptPrefix + echo, "input");
        // Record real command lines in history — never interactive input values.
        if (line && !inInput) {
          history.current.push(line);
        }
        historyPos.current = -1;

        // While collecting input, every line is a value (empty included); only
        // the abort words are special. Dispatch to the input handler.
        if (inInput) {
          setBusy(true);
          try {
            await runInputTurn(line, currentMode);
          } finally {
            setBusy(false);
          }
          return;
        }

        if (!line) return;

        // `clear` is a terminal built-in (like a shell's clear / Ctrl-L): it wipes
        // the screen without touching lab state, in either command or session mode.
        if (line === "clear") {
          setLines([]);
          return;
        }

        setBusy(true);
        try {
          if (currentMode.kind === "session") {
            await runSessionTurn(line, currentMode.sess);
          } else {
            await runCommand(line);
          }
        } finally {
          setBusy(false);
        }
      },
      [
        busy,
        simulator,
        shellPrompt,
        append,
        runCommand,
        runSessionTurn,
        runInputTurn,
      ],
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
      // While collecting interactive input, suppress history recall and path
      // completion: neither should pull command history or filenames into what
      // may be a masked value field. Enter (submit) and plain typing still work.
      if (modeRef.current.kind === "input") {
        if (e.key === "Tab") e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const h = history.current;
        if (h.length === 0) return;
        historyPos.current =
          historyPos.current < 0
            ? h.length - 1
            : Math.max(0, historyPos.current - 1);
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
      if (storageKey) {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
      modeRef.current = { kind: "command" };
      setMode({ kind: "command" });
      idRef.current++;
      const intro =
        greeting ??
        defaultGreeting(
          simulator.lab.metadata?.title,
          simulator.lab.metadata?.summary,
        );
      setLines(
        intro.map((text) => ({
          id: nextId(),
          text,
          kind: "system" as LineKind,
        })),
      );
      inputRef.current?.focus();
    }, [simulator, greeting, storageKey]);

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
        <div
          className={`mock-term mock-term-error ${className ?? ""}`}
          style={style}
        >
          <div className="mock-term-body">
            <div className="term-line term-stderr">
              Failed to load lab: {error}
            </div>
          </div>
        </div>
      );
    }

    const promptPrefix = promptFor(mode, shellPrompt);
    const maskInput =
      mode.kind === "input" && !!mode.req.steps[mode.stepIndex].mask;

    return (
      <div
        className={`mock-term ${className ?? ""}`}
        style={style}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="mock-term-body" ref={scrollRef}>
          {lines.map((l) => (
            <div key={l.id} className={`term-line term-${l.kind}`}>
              {l.text === "" ? " " : l.text}
            </div>
          ))}

          {/* Hide the prompt + input row while a command is processing, so the
            `$` prompt only reappears once output has finished streaming. The
            busy→false transition re-focuses the input (see the busy effect). */}
          {!busy && (
            <div className="term-line term-inputrow">
              <span className="term-prompt">{promptPrefix}</span>
              <input
                ref={inputRef}
                className="term-input"
                type={maskInput ? "password" : "text"}
                value={input}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="terminal input"
              />
            </div>
          )}
        </div>
      </div>
    );
  },
);

function sess_prompt(sess: Session): string {
  return sess.prompt && sess.prompt.length > 0 ? sess.prompt : "> ";
}

/** The caret prefix for the current mode: the shell prompt, the session prompt,
 * or the current input step's question label. */
function promptFor(mode: Mode, shellPrompt: string): string {
  if (mode.kind === "session") return sess_prompt(mode.sess);
  if (mode.kind === "input") return mode.req.steps[mode.stepIndex].prompt;
  return shellPrompt;
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
