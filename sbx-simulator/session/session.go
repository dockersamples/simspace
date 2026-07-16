// Package session runs the interactive agent REPL and one-shot prompt mode on
// top of the scenario engine. It reads from an io.Reader and writes to
// io.Writers so it is fully testable without a terminal. Streaming is cosmetic
// (optional per-line delay) and never changes what is printed. See
// docs/scenario-spec.md §12.
package session

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/dockersamples/sbx-simulator/engine"
	"github.com/dockersamples/sbx-simulator/filesystem"
	"github.com/dockersamples/sbx-simulator/manifest"
	"github.com/dockersamples/sbx-simulator/state"
)

// exitCommands end an interactive session.
var exitCommands = map[string]bool{"/exit": true, "/quit": true}

// shellPrefix marks a REPL line as a real shell command to run rather than an
// agent prompt, mirroring the `!cmd` convention in Claude Code and other agent
// CLIs. Everything after the `!` is executed in the lab root (§12 shell mode).
const shellPrefix = "!"

// Options controls output pacing.
type Options struct {
	Stream bool          // stream output line-by-line
	Delay  time.Duration // per-line delay while streaming
	Think  time.Duration // "Evaluating..." spinner duration before agent replies
}

// spinnerFrames are the braille spinner glyphs animated while "thinking".
var spinnerFrames = []rune{'⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'}

// ANSI escape codes used by the session banner. They are emitted only in
// interactive (streaming) mode so tests and CI, which disable streaming, keep
// plain, assertion-friendly output. See banner.
const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiDim    = "\033[2m"
	ansiBlue   = "\033[38;5;39m" // Docker-ish blue
	ansiYellow = "\033[33m"
)

// whale is the Docker whale, printed at the top of the agent-session banner to
// make it obvious the learner has entered an agent session.
var whale = []string{
	`                  ##         .`,
	`            ## ## ##        ==`,
	`         ## ## ## ##       ===`,
	`     /"""""""""""""""""\___/ ===`,
	`     {                       /  ===-`,
	`     \______ O           __/`,
	`       \    \         __/`,
	`        \____\_______/`,
}

// banner prints a welcome splash when an interactive agent session starts: the
// Docker whale, a title, and a note that the agent is simulated/scripted (so no
// learner mistakes the scripted replies for a live model). Colour is applied
// only when streaming is enabled — an interactive terminal — so test/CI output
// (SBX_SIM_STREAM=0) stays plain text.
func banner(w io.Writer, opts Options) {
	c := func(code, s string) string {
		if !opts.Stream {
			return s
		}
		return code + s + ansiReset
	}

	fmt.Fprintln(w)
	for _, line := range whale {
		fmt.Fprintln(w, c(ansiBlue, line))
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, c(ansiBold, "  SBX Simulator · Agent Session"))
	fmt.Fprintln(w)
	fmt.Fprintln(w, c(ansiYellow, "  ⚠ Simulated environment — the agent's replies are scripted by"))
	fmt.Fprintln(w, c(ansiYellow, "    the lab author for teaching. No real model or sandbox is running."))
	fmt.Fprintln(w)
	fmt.Fprintln(w, c(ansiDim, "  Prefix a line with ! to run a real shell command (e.g. !ls)."))
	fmt.Fprintln(w, c(ansiDim, "  Type /exit or /quit to leave the session."))
	fmt.Fprintln(w)
}

// think shows a brief "Evaluating..." spinner before an agent response, then
// clears the line. It is purely cosmetic and runs only when streaming is on
// (so tests and CI, which disable streaming, are fast and deterministic).
func think(w io.Writer, opts Options) {
	if !opts.Stream || opts.Think <= 0 {
		return
	}
	const interval = 100 * time.Millisecond
	steps := int(opts.Think / interval)
	if steps < 1 {
		steps = 1
	}
	// Blank line above the spinner so it isn't crammed against the prompt.
	fmt.Fprintln(w)
	for i := 0; i < steps; i++ {
		fmt.Fprintf(w, "\r%c Evaluating...", spinnerFrames[i%len(spinnerFrames)])
		time.Sleep(interval)
	}
	// Clear the spinner line before the real response prints.
	fmt.Fprint(w, "\r"+strings.Repeat(" ", 20)+"\r")
}

// WriteLines writes each line (with a trailing newline), pausing between lines
// when streaming is enabled.
func WriteLines(w io.Writer, lines []string, opts Options) {
	for i, line := range lines {
		if opts.Stream && opts.Delay > 0 && i > 0 {
			time.Sleep(opts.Delay)
		}
		fmt.Fprintln(w, line)
	}
}

// agentIndent is prepended to each non-empty line of a simulated agent response
// when streaming, setting the reply visually apart from the learner's prompts.
const agentIndent = "  "

// writeAgentLines writes an agent response, indenting each non-empty line when
// streaming so replies sit apart from the prompt. Non-streaming output stays
// plain and unindented so tests and CI remain assertion-friendly.
func writeAgentLines(w io.Writer, lines []string, opts Options) {
	for i, line := range lines {
		if opts.Stream && opts.Delay > 0 && i > 0 {
			time.Sleep(opts.Delay)
		}
		if opts.Stream && line != "" {
			line = agentIndent + line
		}
		fmt.Fprintln(w, line)
	}
}

// writeResponse renders one agent turn's output — stdout then stderr — indented
// when streaming and followed by a blank line so consecutive turns aren't
// crammed together. The spacing and indentation apply only when streaming, so
// non-streaming (test/CI) output stays plain and exactly asserted.
func writeResponse(out, errOut io.Writer, res *engine.Result, opts Options) {
	writeAgentLines(out, res.Stdout, opts)
	writeAgentLines(errOut, res.Stderr, opts)
	if opts.Stream {
		fmt.Fprintln(out)
	}
}

// Run drives an interactive REPL: it prints the session intro, then reads
// prompts until an exit command or EOF, dispatching each through the engine and
// persisting state after every turn. It prints the outro on exit.
func Run(lab *manifest.Lab, sess *manifest.Session, fs *filesystem.FS, st *state.Store, in io.Reader, out, errOut io.Writer, opts Options) error {
	banner(out, opts)
	WriteLines(out, sess.Intro, opts)

	scanner := bufio.NewScanner(in)
	// Allow long pasted prompts.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for {
		fmt.Fprint(out, sess.PromptString())
		if !scanner.Scan() {
			break // EOF
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if exitCommands[line] {
			break
		}
		if strings.HasPrefix(line, shellPrefix) {
			shell(fs.Root(), strings.TrimPrefix(line, shellPrefix), out, errOut)
			continue
		}
		if err := turn(lab, line, fs, st, out, errOut, opts); err != nil {
			return err
		}
	}

	WriteLines(out, sess.Outro, opts)
	return scanner.Err()
}

// Once processes a single prompt (one-shot `sbx run -p`) and returns its exit
// code.
func Once(lab *manifest.Lab, prompt string, fs *filesystem.FS, st *state.Store, out, errOut io.Writer, opts Options) (int, error) {
	think(out, opts)
	res, err := engine.RunAgent(lab, prompt, fs, st)
	if err != nil {
		return 1, err
	}
	writeResponse(out, errOut, res, opts)
	if err := st.Save(); err != nil {
		return 1, err
	}
	return res.Exit, nil
}

// shell runs cmdline as a real shell command in dir (the lab root), streaming
// its stdout to out and stderr to errOut. Unlike agent replies, this is genuine
// process output: it is never paced or simulated, and it touches no simulator
// state — it lets a learner inspect the real project (e.g. !ls, !cat
// app/server.js) without leaving the session. A non-zero exit is reported but
// does not end the session.
func shell(dir, cmdline string, out, errOut io.Writer) {
	cmdline = strings.TrimSpace(cmdline)
	if cmdline == "" {
		fmt.Fprintln(errOut, "usage: !<command>  — run a real shell command (e.g. !ls, !cat app/server.js)")
		return
	}
	c := exec.Command("sh", "-c", cmdline)
	c.Dir = dir
	c.Stdout = out
	c.Stderr = errOut
	if err := c.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			fmt.Fprintf(errOut, "shell: command exited with status %d\n", exitErr.ExitCode())
		} else {
			fmt.Fprintf(errOut, "shell: %v\n", err)
		}
	}
}

// turn dispatches one REPL prompt and persists the resulting state.
func turn(lab *manifest.Lab, prompt string, fs *filesystem.FS, st *state.Store, out, errOut io.Writer, opts Options) error {
	think(out, opts)
	res, err := engine.RunAgent(lab, prompt, fs, st)
	if err != nil {
		return err
	}
	writeResponse(out, errOut, res, opts)
	return st.Save()
}
