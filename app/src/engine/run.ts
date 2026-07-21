// Runs one command or one agent prompt against a lab: match a scenario, apply
// its effects (or the unmatched default), record history, and return the
// output/exit.

import { applyThen } from "./apply";
import { runBuiltin } from "./builtins";
import { Command } from "./commands";
import { FS } from "./filesystem";
import { match, matchAgent } from "./match";
import { Store } from "./state";
import { Lab, Result, Then } from "./types";

export type { Result };

/**
 * run executes one parsed command: it matches a scenario, applies its effects
 * (or the unmatched default), records the command in history, and returns the
 * output/exit. State mutations are applied to st in place.
 */
export function run(lab: Lab, cmd: Command, fs: FS, st: Store): Result {
  st.appendHistory(cmd.line);

  const m = match(lab, cmd, st);
  if (m) {
    const then = m.scenario.then;
    const { stdout, stderr } = applyThen(then, fs, st, m.args);
    return {
      stdout,
      stderr,
      exit: resolveExit(then, lab),
      matched: m.scenario.id,
      session: then.session,
    };
  }

  // No scenario matched — try built-in filesystem commands before falling back
  // to the lab's unmatched default.
  const builtin = runBuiltin(cmd, fs);
  if (builtin) return builtin;

  const then = unmatchedThen(lab);
  const { stdout, stderr } = applyThen(then, fs, st, {});
  return {
    stdout,
    stderr,
    exit: resolveExit(then, lab),
    matched: "",
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
    stderr: ["command not found — this command is not simulated in this lab."],
    exit: 127,
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
