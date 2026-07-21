// Built-in command handlers that operate on the virtual filesystem. These fire
// only when no scenario matches the typed command, so a scenario with
// `command: ls` (or `cat`, etc.) always takes priority.

import { Command } from "./commands";
import { FS } from "./filesystem";
import { Result } from "./types";

/**
 * runBuiltin checks whether cmd is a recognized built-in filesystem command and
 * returns a Result if so, or null to let the caller apply the unmatched default.
 */
export function runBuiltin(cmd: Command, fs: FS): Result | null {
  switch (cmd.tokens[0]) {
    case "ls":
      return runLs(cmd, fs);
    case "cat":
      return runCat(cmd, fs);
    default:
      return null;
  }
}

function runLs(cmd: Command, fs: FS): Result {
  const raw = cmd.tokens[1] ?? "";
  const target = raw === "." ? "" : raw;

  // No path argument (or ".") means list the root.
  if (!target) {
    return lsDir(fs, "");
  }

  // Path is a file: print just the name.
  if (fs.isFile(target)) {
    return ok([target]);
  }

  // Path is a directory: list its contents.
  if (fs.isDir(target)) {
    return lsDir(fs, target);
  }

  return fail([`ls: ${target}: No such file or directory`]);
}

function lsDir(fs: FS, dir: string): Result {
  const entries = fs.listDir(dir);
  if (entries.length === 0) {
    return ok([]);
  }
  return ok(entries.map((e) => (e.isDir ? e.name + "/" : e.name)));
}

function runCat(cmd: Command, fs: FS): Result {
  const paths = cmd.tokens.slice(1);
  if (paths.length === 0) {
    return fail(["cat: missing file operand"]);
  }

  const stdout: string[] = [];
  const stderr: string[] = [];

  for (const p of paths) {
    if (fs.isDir(p)) {
      stderr.push(`cat: ${p}: Is a directory`);
      continue;
    }
    const content = fs.read(p);
    if (content === undefined) {
      stderr.push(`cat: ${p}: No such file or directory`);
      continue;
    }
    // Emit each line of the file; preserve trailing newline by not adding one.
    const lines = content.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    stdout.push(...lines);
  }

  return {
    stdout,
    stderr,
    exit: stderr.length > 0 ? 1 : 0,
    matched: "__builtin__",
  };
}

function ok(lines: string[]): Result {
  return { stdout: lines, stderr: [], exit: 0, matched: "__builtin__" };
}

function fail(lines: string[]): Result {
  return { stdout: [], stderr: lines, exit: 1, matched: "__builtin__" };
}
