// SbxTerminal renders an in-browser "terminal" that runs an SBX Simulator lab
// from its spec YAML. It mirrors the CLI (cmd/sbx/main.go + session package):
// you type `sbx …` commands at a shell prompt, a `sbx run` scenario can drop
// you into an interactive agent session, and output streams line-by-line with
// the agent "Evaluating…" spinner. Host commands (ls, cat, …) are intentionally
// not simulated.

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Session } from "../engine/types";
import { useSimulator } from "./useSimulator";
import "./SbxTerminal.css";

export interface SbxTerminalProps {
  /** The sbx-simulator.yaml document text. */
  spec: string;
  /** Optional seed for the virtual filesystem, keyed by lab-relative path. */
  files?: Record<string, string>;
  /** Version string reported by `sbx --version`. Defaults to "web". */
  version?: string;
  /** Shell prompt shown in command mode. Defaults to "$ ". */
  shellPrompt?: string;
  /** Override streaming; defaults to the lab's `settings.streaming`. */
  streaming?: boolean;
  /** Override per-line stream delay (ms); defaults to the lab's setting. */
  streamDelayMs?: number;
  /** Override agent "Evaluating…" spinner duration (ms); 0 disables it. */
  agentThinkMs?: number;
  /** Show the title/reset header bar. Defaults to true. */
  showHeader?: boolean;
  /** Extra lines printed once on start (dim). Set to [] to suppress the default. */
  greeting?: string[];
  /** Called with a fresh state snapshot after every command/turn. */
  onStateChange?: (state: Record<string, unknown>) => void;
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

export function SbxTerminal({
  spec,
  files,
  version,
  shellPrompt = "$ ",
  streaming,
  streamDelayMs,
  agentThinkMs,
  showHeader = true,
  greeting,
  onStateChange,
  className,
  style,
}: SbxTerminalProps) {
  const { simulator, error } = useSimulator(spec, files, version);

  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const modeRef = useRef<Mode>({ kind: "command" });
  const idRef = useRef(0);
  const history = useRef<string[]>([]);
  const historyPos = useRef<number>(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const notify = useCallback(() => {
    if (simulator && onStateChange) onStateChange(simulator.state());
  }, [simulator, onStateChange]);

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
        { text: "  SBX Simulator · Agent Session", kind: "title" },
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
      const outcome = simulator.execute(line);
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
          const ao = simulator.prompt(oneShot);
          await emitAgentTurn(ao);
          notify();
          return;
        }
        await enterSession(outcome.session);
      }
    },
    [simulator, emit, think, emitAgentTurn, enterSession, notify],
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
        // Shell escape (`!cmd`): try the lab's scripted shell scenarios first,
        // and only fall back to the "not mocked" message if none match.
        const shellOutcome = simulator.shell(line.slice(1));
        if (shellOutcome) {
          await emit(
            shellOutcome.lines.map((l) => ({
              text: l.text,
              kind: (l.stream === "stderr" ? "stderr" : "stdout") as LineKind,
            })),
          );
          notify();
          return;
        }
        await emit([
          {
            text: "shell escape (!) is not available in the web simulator; host commands are not mocked.",
            kind: "stderr",
          },
        ]);
        return;
      }
      await think();
      const ao = simulator.prompt(line);
      await emitAgentTurn(ao);
      notify();
    },
    [simulator, emit, think, emitAgentTurn, notify],
  );

  const submit = useCallback(async () => {
    if (busy || !simulator) return;
    const raw = input;
    const line = raw.trim();

    const mode = modeRef.current;
    const promptPrefix =
      mode.kind === "session" ? sess_prompt(mode.sess) : shellPrompt;

    // Echo the typed line with its prompt, always (even when empty).
    append(promptPrefix + raw, "input");
    setInput("");
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
      inputRef.current?.focus();
    }
  }, [busy, simulator, input, shellPrompt, append, runCommand, runSessionTurn]);

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

  const reset = useCallback(() => {
    if (!simulator) return;
    simulator.reset();
    modeRef.current = { kind: "command" };
    idRef.current++;
    const intro =
      greeting ??
      defaultGreeting(simulator.lab.metadata?.title, simulator.lab.metadata?.summary);
    setLines(
      intro.map((text) => ({ id: nextId(), text, kind: "system" as LineKind })),
    );
    notify();
    inputRef.current?.focus();
  }, [simulator, greeting, notify]);

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
      {showHeader && (
        <div className="sbx-term-header">
          <span className="sbx-term-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="sbx-term-title">
            {simulator?.lab.metadata?.title ?? "SBX Simulator"}
          </span>
          <button
            type="button"
            className="sbx-term-reset"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
          >
            Reset
          </button>
        </div>
      )}

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
}

function sess_prompt(sess: Session): string {
  return sess.prompt && sess.prompt.length > 0 ? sess.prompt : "> ";
}

function defaultGreeting(title?: string, summary?: string): string[] {
  const lines: string[] = [];
  if (title) lines.push(title);
  if (summary) lines.push(summary);
  lines.push("Type a command to begin — e.g. `sbx run`.");
  return lines;
}
