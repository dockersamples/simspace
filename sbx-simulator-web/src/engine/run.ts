// Runs one command or one agent prompt against a lab: match a scenario, apply
// its effects (or the unmatched default), record history, and return the
// output/exit. Ported from engine/run.go.

import { applyThen } from "./apply";
import { Command } from "./commands";
import { FS } from "./filesystem";
import { match, matchAgent } from "./match";
import { Store } from "./state";
import { Lab, Session, Then } from "./types";

/** The outcome of running one command or prompt against a lab. */
export interface Result {
  stdout: string[];
  stderr: string[];
  exit: number;
  /** Matched scenario ID, or "" if the unmatched default was used. */
  matched: string;
  /** Set when the matched command scenario declares a session effect. */
  session?: Session;
}

/**
 * run executes one parsed command: it matches a scenario, applies its effects
 * (or the unmatched default), records the command in history, and returns the
 * output/exit. State mutations are applied to st in place.
 */
export function run(lab: Lab, cmd: Command, fs: FS, st: Store): Result {
  st.appendHistory(cmd.line);

  const m = match(lab, cmd, st);
  const then = m ? m.scenario.then : unmatchedThen(lab);
  const args = m ? m.args : {};

  const { stdout, stderr } = applyThen(then, fs, st, args);

  return {
    stdout,
    stderr,
    exit: resolveExit(then, lab),
    matched: m ? m.scenario.id : "",
    session: then.session,
  };
}

/**
 * runAgent dispatches a single agent prompt (a REPL turn or one-shot `-p`): it
 * matches an agent scenario (or falls back to defaults.unmatchedAgent), applies
 * its effects, records the prompt in history, and returns the output.
 */
export function runAgent(lab: Lab, prompt: string, fs: FS, st: Store): Result {
  st.appendHistory("agent> " + prompt);

  const m = matchAgent(lab, prompt, st);
  const then = m ? m.scenario.then : unmatchedAgentThen(lab);

  const { stdout, stderr } = applyThen(then, fs, st, {});

  return {
    stdout,
    stderr,
    exit: resolveExit(then, lab),
    matched: m ? m.scenario.id : "",
  };
}

function unmatchedThen(lab: Lab): Then {
  if (lab.defaults?.unmatched) {
    return lab.defaults.unmatched;
  }
  return {
    stderr: ["Error: unknown or unexpected command in this lab."],
    exit: 1,
  };
}

function unmatchedAgentThen(lab: Lab): Then {
  if (lab.defaults?.unmatchedAgent) {
    return lab.defaults.unmatchedAgent;
  }
  return {
    output: ["Agent: I'm not sure how to help with that in this lab."],
  };
}

/**
 * resolveExit picks the exit code: the scenario's own exit, else the lab's
 * default exit, else 0.
 */
function resolveExit(then: Then, lab: Lab): number {
  if (then.exit !== undefined) return then.exit;
  if (lab.defaults?.exit !== undefined) return lab.defaults.exit;
  return 0;
}
