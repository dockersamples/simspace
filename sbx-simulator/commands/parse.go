// Package commands parses a raw sbx invocation into the structured form the
// engine matches against. See docs/scenario-spec.md §6.
package commands

import "strings"

// Command is a parsed sbx invocation (everything after the binary name).
type Command struct {
	// Line is the reconstructed command line including the leading "sbx",
	// recorded verbatim in state history.
	Line string
	// Tokens are the positional (non-flag) tokens, in order. Leading tokens
	// form the subcommand path a scenario's `command` matches; the rest are
	// positional arguments.
	Tokens []string
	// Flags maps a flag name (leading dashes stripped) to its value. A
	// boolean-style flag maps to "".
	Flags map[string]string
}

// Parse splits args (os.Args without the program name) into positional tokens
// and flags.
//
// Flag conventions (v1.0, documented for authors):
//   - --key=value           -> Flags["key"] = "value"
//   - --key value           -> Flags["key"] = "value" (next token, if it does
//     not itself start with "-")
//   - --key / -k (at end, or followed by another flag) -> Flags["key"] = ""
//
// Because Labspaces hands learners exact commands to type, authors control the
// invocation and this simple convention is sufficient. A boolean flag placed
// immediately before a positional would consume it as a value; author around
// that with `--key=` form or flag ordering.
func Parse(args []string) Command {
	cmd := Command{
		Line:  "sbx " + strings.Join(args, " "),
		Flags: map[string]string{},
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !isFlag(arg) {
			cmd.Tokens = append(cmd.Tokens, arg)
			continue
		}

		name := strings.TrimLeft(arg, "-")
		if eq := strings.IndexByte(name, '='); eq >= 0 {
			cmd.Flags[name[:eq]] = name[eq+1:]
			continue
		}
		// Consume the next token as this flag's value unless it is itself a
		// flag or absent.
		if i+1 < len(args) && !isFlag(args[i+1]) {
			cmd.Flags[name] = args[i+1]
			i++
			continue
		}
		cmd.Flags[name] = ""
	}

	return cmd
}

// isFlag reports whether a token is a flag ("-x" or "--long"). A bare "-" is
// treated as a positional.
func isFlag(tok string) bool {
	return len(tok) > 1 && tok[0] == '-'
}
