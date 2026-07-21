// Parses a raw command line (argv) into the structured form the engine matches
// against.

export interface Command {
  /** Reconstructed command line, for history. */
  line: string;
  /** Positional (non-flag) tokens in order. Leading tokens form the path. */
  tokens: string[];
  /** Flag name (leading dashes stripped) -> value. Boolean flags map to "". */
  flags: Record<string, string>;
}

/**
 * parseCommand splits args into positional tokens and flags.
 *
 * Flag conventions:
 *   --key=value  -> flags["key"] = "value"
 *   --key value  -> flags["key"] = "value" (next token, if not itself a flag)
 *   --key / -k   -> flags["key"] = "" (at end, or followed by another flag)
 */
export function parseCommand(args: string[]): Command {
  const cmd: Command = {
    line: args.join(" "),
    tokens: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!isFlag(arg)) {
      cmd.tokens.push(arg);
      continue;
    }

    const name = arg.replace(/^-+/, "");
    const eq = name.indexOf("=");
    if (eq >= 0) {
      cmd.flags[name.slice(0, eq)] = name.slice(eq + 1);
      continue;
    }
    // Consume the next token as this flag's value unless it is a flag/absent.
    if (i + 1 < args.length && !isFlag(args[i + 1])) {
      cmd.flags[name] = args[i + 1];
      i++;
      continue;
    }
    cmd.flags[name] = "";
  }

  return cmd;
}

/** isFlag reports whether a token is a flag ("-x" or "--long"). A bare "-" is positional. */
function isFlag(tok: string): boolean {
  return tok.length > 1 && tok[0] === "-";
}

/**
 * tokenize splits a raw command line into argv, honoring single and double
 * quotes (so `-p "add a health endpoint"` is one token). The browser terminal
 * gives us a single string, unlike a real shell that pre-splits argv.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) {
    tokens.push(cur);
  }
  return tokens;
}
