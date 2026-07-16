// Simulator is the high-level engine facade the React terminal drives. It owns
// the parsed lab, the live state store, and the virtual filesystem, and exposes
// command / agent-prompt execution plus the simulator meta-commands (`--version`,
// `sim reset`). It replaces the per-process CLI in cmd/sbx/main.go with a single
// long-lived object; "reset" re-seeds state and files just like deleting
// $SBX_SIM_HOME on the CLI.

import { parseCommand, tokenize } from "./commands";
import { FS, FSError } from "./filesystem";
import { checkSchemaVersion, parseManifest } from "./manifest";
import { run, runAgent } from "./run";
import { Store } from "./state";
import { Lab, Options, resolveOptions, Session } from "./types";

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
  /** The sbx-simulator.yaml document text. */
  spec: string;
  /** Optional seed for the virtual filesystem, keyed by lab-relative path. */
  files?: Record<string, string>;
  /** Version string reported by `sbx --version`. */
  version?: string;
}

export class Simulator {
  readonly lab: Lab;
  readonly options: Options;
  private readonly seedFiles: Record<string, string>;
  private readonly version: string;
  private store: Store;
  private fs: FS;

  constructor(init: SimulatorInit) {
    this.lab = parseManifest(init.spec);
    checkSchemaVersion(this.lab.version);
    this.options = resolveOptions(this.lab.settings);
    this.seedFiles = init.files ?? {};
    this.version = init.version ?? "web";
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

  /** reset re-seeds state and the filesystem from the manifest, as `sbx sim reset` does. */
  reset(): void {
    this.store = Store.seed(this.lab.state);
    this.fs = new FS(this.seedFiles);
  }

  /**
   * execute runs one shell command line (e.g. "sbx run", "sbx status"). Only
   * `sbx` commands are simulated — host commands (ls, cat, …) are intentionally
   * not mocked and report a "command not found"-style message.
   */
  execute(line: string): CommandOutcome {
    const argv = tokenize(line.trim());
    if (argv.length === 0) {
      return { lines: [], exit: 0, matched: "" };
    }
    if (argv[0] !== "sbx") {
      return {
        lines: [
          err(
            `${argv[0]}: command not found — only \`sbx\` is simulated in this lab.`,
          ),
        ],
        exit: 127,
        matched: "",
      };
    }

    const args = argv.slice(1);

    // Simulator meta-commands, handled before the scenario engine.
    if (args.length === 1 && (args[0] === "--version" || args[0] === "version")) {
      return { lines: [out(`sbx simulator ${this.version}`)], exit: 0, matched: "" };
    }
    if (args[0] === "sim") {
      return this.sim(args.slice(1));
    }

    const cmd = parseCommand(args);
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
   * oneShotPrompt returns the `-p`/`--prompt` value if the command line requests
   * non-interactive agent execution, so callers can run a single prompt instead
   * of entering the REPL. Mirrors the CLI's `sbx run -p "..."`.
   */
  oneShotPrompt(line: string): string | null {
    const cmd = parseCommand(tokenize(line.trim()).slice(1));
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

  private sim(args: string[]): CommandOutcome {
    if (args.length === 0) {
      return {
        lines: [
          err("sbx: usage: sbx sim <command>"),
          err(""),
          err("Commands:"),
          err("  reset   Reset simulator state (start the lab over)"),
        ],
        exit: 1,
        matched: "",
      };
    }
    if (args[0] === "reset") {
      this.reset();
      return {
        lines: [
          out("Simulator state reset. The lab will start fresh on the next command."),
        ],
        exit: 0,
        matched: "",
      };
    }
    return {
      lines: [err(`sbx: unknown sim command "${args[0]}"`)],
      exit: 1,
      matched: "",
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
  if (e instanceof FSError) return "sbx: " + e.message;
  return "sbx: " + (e as Error).message;
}
