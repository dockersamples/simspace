// Simulator is the high-level engine facade the React terminal drives. It owns
// the parsed lab, the live state store, and the virtual filesystem, and exposes
// command / agent-prompt execution. "reset" re-seeds state and files from the
// manifest.

import { ciRunToState, resolveCIRun } from "./ci";
import { parseCommand, tokenize } from "./commands";
import { FS, FSError } from "./filesystem";
import { checkSchemaVersion, parseManifest } from "./manifest";
import { run, runAgent } from "./run";
import { Store } from "./state";
import {
  Lab,
  Options,
  RenderedLine,
  resolveOptions,
  Session,
  StateValue,
} from "./types";

/** The state path holding the append-only list of CI run records (§15.3). */
const CI_RUNS_KEY = "ci.runs";

/**
 * One line of terminal output tagged with the stream it belongs to. Carries the
 * cosmetic `delayMs` / `pause` from the engine so the terminal can pace it.
 */
export interface OutputLine extends RenderedLine {
  stream: "stdout" | "stderr";
}

/** The result of executing one command line at the shell prompt. */
export interface CommandOutcome {
  lines: OutputLine[];
  exit: number;
  matched: string;
  /** When set, the caller should enter an interactive agent session. */
  session?: Session;
}

/** The result of executing one agent prompt inside a session. */
export interface AgentOutcome {
  lines: OutputLine[];
  exit: number;
  matched: string;
}

export interface SimulatorInit {
  /** The simulator YAML document text. */
  spec: string;
  /** Optional seed for the virtual filesystem, keyed by lab-relative path. */
  files?: Record<string, string>;
}

export class Simulator {
  readonly lab: Lab;
  readonly options: Options;
  private readonly seedFiles: Record<string, string>;
  private store: Store;
  private fs: FS;

  constructor(init: SimulatorInit) {
    this.lab = parseManifest(init.spec);
    checkSchemaVersion(this.lab.version);
    this.options = resolveOptions(this.lab.settings);
    this.seedFiles = init.files ?? {};
    this.store = Store.seed(this.lab.state);
    this.fs = new FS(this.seedFiles);
  }

  /** state returns a snapshot of the current runtime state, for inspection. */
  state(): Record<string, unknown> {
    return this.store.snapshot();
  }

  /** files returns a snapshot of the current virtual filesystem. */
  files(): Record<string, string> {
    return this.fs.snapshot();
  }

  /** reset re-seeds state and the filesystem from the manifest. */
  reset(): void {
    this.store = Store.seed(this.lab.state);
    this.fs = new FS(this.seedFiles);
  }

  /** getState returns the current value at a dot-path, or null if absent. */
  getState(path: string): StateValue {
    const { value, present } = this.store.get(path);
    return present && value !== undefined ? value : null;
  }

  /** setControl writes a value to the state store (called by control toggles). */
  setControl(path: string, value: StateValue): void {
    this.store.set(path, value);
  }

  /**
   * rerunWorkflow re-triggers a catalog workflow without a command — the model
   * behind the CI panel's Re-run button. The run is re-resolved against the
   * CURRENT state (no explicit conclusion), so a step gated on `requires` picks
   * up configuration changed since the last run (e.g. secrets just enabled).
   * The commit label carries over from the run being re-run.
   */
  rerunWorkflow(workflowId: string, opts?: { commit?: string | null }): void {
    const existing = this.store.get(CI_RUNS_KEY).value;
    const count = Array.isArray(existing) ? existing.length : 0;
    const run = resolveCIRun(
      { workflow: workflowId, commit: opts?.commit ?? undefined },
      this.lab.workflows,
      count + 1,
      (path) => this.getState(path),
    );
    this.store.append(CI_RUNS_KEY, ciRunToState(run));
  }

  /** writeFile creates or overwrites a file in the virtual filesystem. */
  writeFile(path: string, content: string): void {
    this.fs.create(path, content);
  }

  /** listDir returns the immediate children of a directory in the virtual FS. */
  listDir(dir: string = ""): { name: string; isDir: boolean }[] {
    return this.fs.listDir(dir);
  }

  /**
   * execute runs one command line against the lab's scenarios. `terminalId`
   * identifies the terminal the command came from, so scenarios can scope
   * themselves with `when.terminal`.
   */
  execute(line: string, terminalId?: string): CommandOutcome {
    const argv = tokenize(line.trim());
    if (argv.length === 0) {
      return { lines: [], exit: 0, matched: "" };
    }

    const cmd = parseCommand(argv);
    let result;
    try {
      result = run(this.lab, cmd, this.fs, this.store, terminalId);
    } catch (e) {
      return { lines: [err({ text: fsMessage(e) })], exit: 1, matched: "" };
    }

    return {
      lines: [...result.stdout.map(out), ...result.stderr.map(err)],
      exit: result.exit,
      matched: result.matched,
      session: result.session,
    };
  }

  /**
   * oneShotPrompt returns the `-p`/`--prompt` value if the command line
   * requests non-interactive agent execution, so callers can run a single
   * prompt instead of entering the REPL.
   */
  oneShotPrompt(line: string): string | null {
    const cmd = parseCommand(tokenize(line.trim()));
    if ("p" in cmd.flags) return cmd.flags.p;
    if ("prompt" in cmd.flags) return cmd.flags.prompt;
    return null;
  }

  /**
   * prompt dispatches a single agent prompt (a REPL turn or one-shot).
   * `terminalId` scopes `when.terminal` on agent scenarios.
   */
  prompt(text: string, terminalId?: string): AgentOutcome {
    let result;
    try {
      result = runAgent(this.lab, text, this.fs, this.store, terminalId);
    } catch (e) {
      return { lines: [err({ text: fsMessage(e) })], exit: 1, matched: "" };
    }
    return {
      lines: [...result.stdout.map(out), ...result.stderr.map(err)],
      exit: result.exit,
      matched: result.matched,
    };
  }
}

function out(line: RenderedLine): OutputLine {
  return { ...line, stream: "stdout" };
}

function err(line: RenderedLine): OutputLine {
  return { ...line, stream: "stderr" };
}

function fsMessage(e: unknown): string {
  if (e instanceof FSError) return e.message;
  return (e as Error).message;
}
