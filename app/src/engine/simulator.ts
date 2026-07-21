// Simulator is the high-level engine facade the React terminal drives. It owns
// the parsed lab, the live state store, and the virtual filesystem, and exposes
// command / agent-prompt execution. "reset" re-seeds state and files from the
// manifest.

import { parseCommand, tokenize } from "./commands";
import { FS, FSError } from "./filesystem";
import { checkSchemaVersion, parseManifest } from "./manifest";
import { run, runAgent } from "./run";
import { Store } from "./state";
import { Lab, Options, resolveOptions, Session, StateValue } from "./types";

/** One line of terminal output tagged with the stream it belongs to. */
export interface OutputLine {
  text: string;
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

  /** writeFile creates or overwrites a file in the virtual filesystem. */
  writeFile(path: string, content: string): void {
    this.fs.create(path, content);
  }

  /** listDir returns the immediate children of a directory in the virtual FS. */
  listDir(dir: string = ""): { name: string; isDir: boolean }[] {
    return this.fs.listDir(dir);
  }

  /** execute runs one command line against the lab's scenarios. */
  execute(line: string): CommandOutcome {
    const argv = tokenize(line.trim());
    if (argv.length === 0) {
      return { lines: [], exit: 0, matched: "" };
    }

    const cmd = parseCommand(argv);
    let result;
    try {
      result = run(this.lab, cmd, this.fs, this.store);
    } catch (e) {
      return { lines: [err(fsMessage(e))], exit: 1, matched: "" };
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

  /** prompt dispatches a single agent prompt (a REPL turn or one-shot). */
  prompt(text: string): AgentOutcome {
    let result;
    try {
      result = runAgent(this.lab, text, this.fs, this.store);
    } catch (e) {
      return { lines: [err(fsMessage(e))], exit: 1, matched: "" };
    }
    return {
      lines: [...result.stdout.map(out), ...result.stderr.map(err)],
      exit: result.exit,
      matched: result.matched,
    };
  }
}

function out(text: string): OutputLine {
  return { text, stream: "stdout" };
}

function err(text: string): OutputLine {
  return { text, stream: "stderr" };
}

function fsMessage(e: unknown): string {
  if (e instanceof FSError) return e.message;
  return (e as Error).message;
}
