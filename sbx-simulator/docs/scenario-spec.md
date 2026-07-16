# SBX Simulator — Scenario / `sbx-simulator.yaml` Specification

**Status:** Draft **Schema version:** 1.1

> **1.1 adds interactive agent sessions** (§12): the `when.agent` /
> `when.promptContains` matchers, the `then.session` effect, top-level
> `settings`, and `defaults.unmatchedAgent`. It also adds `when.shell` (§6.6)
> for mocking `!cmd` shell escapes inside a session. All 1.0 labs remain valid.

This document specifies the `sbx-simulator.yaml` file that authors write to define a lab.
It is the contract between Labspaces, the lab author, and the SBX Simulator
engine. It resolves the open questions in `SPEC.md`.

---

## 1. Core model

`sbx` is a **drop-in CLI**, so it is launched as a **fresh process on every
command**. There is no long-lived process to hold "runtime state" in memory.
Therefore the simulator is a **filesystem-backed state machine**:

```
                   ┌─────────────────────────────────────────────┐
   $ sbx run web   │ 1. load persisted state (or init from lab)   │
        ─────────► │ 2. parse command + args                      │
                   │ 3. find FIRST scenario whose `when` matches   │
                   │    (command + args + current state)          │
                   │ 4. apply `then`: output, files, state deltas │
                   │ 5. persist new state, exit with code         │
                   └─────────────────────────────────────────────┘
```

Consequences that drive the schema:

- **State is the source of truth.** Every scenario match is gated on, and every
  effect mutates, the persisted state. "Where am I in the lab right now?" is
  answered entirely by state facts.
- **Determinism.** Given the same state and the same command line, the same
  scenario always fires. No time, no randomness, no network, no LLM.
- **First-match-wins, in author order.** Authors put specific cases before
  general fallbacks. Ordering is the author's control surface.

---

## 2. State store (runtime state on disk)

The engine persists state as a single file so it survives between invocations.

- **Location:** `$SBX_SIM_HOME/state.json`. `SBX_SIM_HOME` defaults to
  `./.sbx-sim/` relative to the resolved lab root. (JSON on disk for exact,
  comment-free round-tripping; authors never edit it by hand.)
- **Lab discovery:** the lab manifest is found via `$SBX_SIM_LAB` if set,
  otherwise by searching upward from `$PWD` for `sbx-simulator.yaml`.
- **Initialization:** on the first command (no `state.json` yet), state is
  seeded from the manifest's `state:` block (§4).
- **Reset:** delete `$SBX_SIM_HOME/`, either directly (Labspaces does this via a
  lab-start hook) or with the `sbx sim reset` convenience command. Simulator-only
  meta-commands live under the `sbx sim` namespace so the top-level command
  surface stays a faithful drop-in for the real CLI.

State is a tree of arbitrary keys. Scenarios read/write it with **dot-paths**
(`sandbox.running`, `agent.active`, `phase`). The engine also maintains one
reserved key automatically:

- `history` — an append-only list of the raw command lines executed. The engine
  appends to it after every command; authors may read it but should not need to
  set it.

---

## 3. Top-level `sbx-simulator.yaml` shape

```yaml
version: "1.0"            # REQUIRED. Scenario schema version this file targets.

metadata:                 # REQUIRED. Human/catalog info.
  id: sandbox-lifecycle
  title: "Sandbox Lifecycle"
  summary: "Start, inspect, and stop a Docker Sandbox."
  authors: ["Michael Irwin"]

compatibility:            # OPTIONAL. Simulator versions this lab runs on.
  simulator: ">=1.0 <2.0"

objectives:               # OPTIONAL. Shown by Labspaces; not used by the engine.
  - "Start a sandbox with `sbx run`"
  - "Check status and read logs"
  - "Stop it cleanly"

state: { ... }            # OPTIONAL. Initial runtime state. See §4.

settings: { ... }         # OPTIONAL. Presentation settings. See §11.

defaults: { ... }         # OPTIONAL. Cross-scenario defaults. See §8.

scenarios: [ ... ]        # REQUIRED. Ordered list. See §5–7.
```

Field summary:

| Field           | Required | Purpose                                           |
| --------------- | -------- | ------------------------------------------------- |
| `version`       | yes      | Schema version; engine validates/upgrades against |
| `metadata`      | yes      | Catalog + display info (opaque to the engine)     |
| `compatibility` | no       | Semver range of simulator versions supported      |
| `objectives`    | no       | Author/Labspaces display only                     |
| `state`         | no       | Seed for the state store (empty tree if omitted)  |
| `settings`      | no       | Output streaming/pacing (§11)                     |
| `defaults`      | no       | Fallbacks/behavior applied to every scenario      |
| `scenarios`     | yes      | The ordered match rules                           |

---

## 4. `state` — initial runtime state

Mirrors `SPEC.md`. Any keys are allowed; these are conventional:

```yaml
state:
  sandbox:
    running: false
  agent:
    active: false
  organization:
    approvalRequired: false
  mcp:
    enabled: true
  phase: start            # optional linear-lab cursor
```

---

## 5. Scenario object

```yaml
scenarios:
  - id: start-sandbox         # REQUIRED, unique. Used in errors/traces.
    description: "..."        # OPTIONAL, author note.
    when: { ... }             # REQUIRED. Match conditions. §6
    then: { ... }             # REQUIRED. Effects.          §7
```

Matching algorithm (per invocation):

1. Iterate `scenarios` **top to bottom**.
2. The first scenario whose **entire** `when` is satisfied by the current
   command line **and** current state is selected.
3. Its `then` is applied.
4. If none match, the engine applies `defaults.unmatched` (§8).

---

## 6. `when` — match conditions

All present conditions must hold (logical AND). Omitted conditions are ignored.

```yaml
when:
  command: run                 # command path after `sbx`. String or list.
  args:                        # arg/flag matchers (see below)
    name: "web"
  agent: true                  # match an agent prompt, not a CLI command (§6.5)
  prompt: "Add a /health..."   # EXACT prompt string (§6.3)
  promptContains: [health]     # OR keyword triggers (§6.3)
  state:                       # state preconditions (dot-path -> expected)
    sandbox.running: false
```

A scenario is either a **command scenario** (matched against a typed `sbx …`
command line) or an **agent scenario** (`agent: true`, matched against a prompt
typed in a session or passed via `sbx run -p`). `command` and `agent` are
mutually exclusive.

### 6.1 `command` — the command path

Everything after the `sbx` binary name, up to the first flag/positional, as an
ordered path. Accepts a **space-joined string** or a **list**; these are
equivalent:

```yaml
command: run
command: "policy allow network"
command: [policy, allow, network]
```

Matching is on the leading subcommand tokens only; positional values and flags
are matched via `args`. A bare `command:` with no `args:` matches that
subcommand regardless of its arguments.

### 6.2 `args` — argument matchers

`args` is a map of name → matcher. Names are resolved against the parsed command
line in this order: matching `--flag`/`-f`, then declared positionals. Values:

```yaml
args:
  name: "web"          # scalar: equals (string compare)
  publish: true        # boolean: flag is present
  detach: false        # boolean: flag is absent
  region:              # object matcher:
    any: true          #   present with any value (also captures it, see §7.4)
  count:
    oneOf: ["1", "2"]  #   value is one of a set
```

v1.0 matchers: scalar-equals, `any`, `oneOf`, boolean presence. (Regex/range
are explicitly deferred; see §11.)

### 6.3 `prompt` / `promptContains` — prompt matching

A prompt is matched two ways; a scenario may set at most one:

- `prompt: "<text>"` — **exact string equality** after trimming surrounding
  whitespace. Labspaces instructions give the learner paste-exact text. In a
  command scenario the prompt is the positional args after the command path; in
  an agent scenario it is the whole typed line.
- `promptContains: [a, b]` — **keyword trigger**: matches when the prompt
  contains *every* listed substring, case-insensitively. Use it for prompts
  that should tolerate phrasing (e.g. `["health", "endpoint"]` matches both
  "add a health endpoint" and "make an endpoint for health checks").

```yaml
when:
  agent: true
  prompt: "Add a /health endpoint that returns 200"
---
when:
  agent: true
  promptContains: [health, endpoint]
```

An agent scenario with **neither** matcher is the catch-all for "any other
prompt" — place it last (see also `defaults.unmatchedAgent`, §8). Order matters:
exact scenarios first, keyword scenarios next, catch-all last.

### 6.4 `state` — preconditions

Map of dot-path → expected value. v1.0 semantics are **equality**. A missing key
compares as its zero value (`null`/absent), so `sandbox.running: false` matches
both an explicit `false` and an unset key.

### 6.5 `agent` — dispatch context

`agent: true` marks an **agent scenario**, matched only against prompts (REPL
turns or `sbx run -p`), never against a typed CLI command. Command scenarios
(those with `command`, or with neither `command` nor `agent`) are never matched
against agent prompts. This keeps the two dispatch paths cleanly separated:
`command` and `agent` may not both appear in one `when`.

### 6.6 `shell` — dispatch context

`shell: true` marks a **shell scenario**, matched only against shell-escape
lines (`!cmd`) typed inside a session (§12.4). It uses the same `prompt` /
`promptContains` + `state` matchers as an agent scenario, applied to the command
text *after* the `!` (a leading `!` on the matcher is tolerated, so
`prompt: "cat app/server.js"` and `prompt: "!cat app/server.js"` are
equivalent). A shell scenario with neither `prompt` nor `promptContains` is the
catch-all for any shell command. Shell scenarios are never matched against CLI
commands or agent prompts, and `shell` is mutually exclusive with `command` and
`agent`.

Shell scenarios let a lab **mock** an inspection command (`!cat …`, `!ls …`) so
a learner sees author-controlled output instead of whatever the host would
produce. Matching is tried *first*, before the command runs:

- In the **CLI**, `!cmd` runs the real process (§12.4) only when no shell
  scenario matches; a match short-circuits the real command entirely.
- In the **web simulator**, which has no real shell, a match is the only way to
  produce output — an unmatched `!cmd` reports that host commands are not
  mocked.

```yaml
  - id: shell-cat-server
    when:
      shell: true
      prompt: "cat app/server.js"
    then:
      output:
        - "const express = require('express');"
        - "app.listen(3000);"
```

---

## 7. `then` — effects

Applied in a fixed order so authors can reason about them: **files → state →
output → exit**. (Files first so output can describe what changed; state before
output so templated output can read the new values.)

```yaml
then:
  files: [ ... ]     # filesystem mutations, §7.1
  state: { ... }     # state deltas (dot-path -> new value), §7.2
  output: [ ... ]    # stdout lines, §7.3
  stderr: [ ... ]    # optional stderr lines
  exit: 0            # optional exit code (default 0)
  mcp: [ ... ]       # optional mocked MCP call blocks, §9
  session: { ... }   # optional: enter an interactive agent session, §12
```

### 7.1 `files` — filesystem operations

An ordered list of single-key operations. Paths are relative to the lab root.

```yaml
files:
  - mkdir: "logs"
  - create: "logs/sandbox.log"          # create/overwrite with content
    content: |
      [sim] sandbox 'web' started
  - append: "app/hello.txt"             # append content to end
    content: "\nSandbox is now running."
  - replace: "app/server.js"            # substring/line replacement
    find: "PORT = 3000"
    with: "PORT = 8080"
  - delete: "tmp/cache"                 # remove file or directory
  - copy: "app/hello.txt"               # copy from starter/template
    to: "app/hello.bak"
```

v1.0 ops: `mkdir`, `create` (+`content`), `append` (+`content`), `replace`
(+`find`/`with`), `delete`, `copy` (+`to`). `content`/`with` support templating
(§7.4). A `replace` whose `find` is absent is a hard error (fails the lab fast,
so authoring mistakes surface immediately rather than silently no-op'ing).

### 7.2 `state` — state deltas

Map of dot-path → new value. Sets (creating intermediate objects as needed).

```yaml
state:
  sandbox.running: true
  phase: running
```

List append uses the `+=` suffix convention:

```yaml
state:
  sandbox.events += "started"     # append to the list at sandbox.events
```

### 7.3 `output` / `stderr`

Ordered list of lines written verbatim (plus trailing newline). Templating
(§7.4) applies. To keep the "transparent simulation" principle, Labspaces —
not the manifest — is responsible for the ambient "simulated environment"
banner; individual lines here should read like real `sbx` output.

```yaml
output:
  - "Starting sandbox 'web'..."
  - "Sandbox is running. Connect with: sbx exec web"
```

### 7.4 Templating

Output, `content`, and `with` support minimal `{{ }}` interpolation:

- `{{ args.<name> }}` — a captured argument value (captured when matched by
  scalar equality, `any`, or `oneOf`).
- `{{ state.<dot.path> }}` — a value from the **post-delta** state.

```yaml
when:
  command: run
  args: { name: { any: true } }
then:
  output:
    - "Starting sandbox '{{ args.name }}'..."
  state:
    sandbox.name: "{{ args.name }}"
```

No logic, loops, or expressions in v1.0 — substitution only.

---

## 8. `defaults`

```yaml
defaults:
  unmatched:                 # applied when NO command scenario matches
    stderr:
      - "Error: unknown or unexpected command in this lab."
    exit: 1
  unmatchedAgent:            # applied when NO agent scenario matches a prompt
    output:
      - "Agent: I'm not sure how to help with that in this lab."
  exit: 0                    # default exit code for scenarios that omit it
```

If `defaults.unmatched` is omitted, the engine emits a generic `unknown
command` error to stderr with exit code 1. If `defaults.unmatchedAgent` is
omitted, an unmatched prompt prints a generic "I don't know how to help" line
(exit 0, so a session continues).

---

## 9. MCP mocking (`then.mcp`)

Renders a mocked tool call/result sequence. No external service is contacted.

```yaml
then:
  mcp:
    - tool: "github.search"
      arguments:
        repo: "docker/sandbox"
      result: |
        3 repositories found.
```

The engine formats each block into `sbx`-style MCP output. Governance can gate
MCP: if `state.mcp.enabled` is false, author a higher-priority scenario that
matches and returns a "MCP disabled by policy" message instead.

---

## 10. Worked example — the "Sandbox Lifecycle" starter lab

Grounded in the existing `.workspace/` starter project.

```yaml
version: "1.0"

metadata:
  id: sandbox-lifecycle
  title: "Sandbox Lifecycle"
  summary: "Start, inspect, and stop a Docker Sandbox."
  authors: ["Michael Irwin"]

compatibility:
  simulator: ">=1.0 <2.0"

objectives:
  - "Start a sandbox with `sbx run`"
  - "Check its status and read logs"
  - "Stop it cleanly"

state:
  sandbox:
    running: false
  phase: start

defaults:
  unmatched:
    stderr: ["Error: that command isn't part of this lab yet."]
    exit: 1

scenarios:
  # --- run: happy path ---
  - id: run-start
    when:
      command: run
      state: { sandbox.running: false }
    then:
      files:
        - mkdir: "logs"
        - create: "logs/sandbox.log"
          content: "[sim] sandbox started\n"
      state:
        sandbox.running: true
        phase: running
      output:
        - "Starting sandbox..."
        - "Sandbox is running. View logs with: sbx logs"

  # --- run: already running (more specific state, but placed after so
  #     first-match still resolves correctly since preconditions differ) ---
  - id: run-already
    when:
      command: run
      state: { sandbox.running: true }
    then:
      stderr: ["Error: a sandbox is already running."]
      exit: 1

  # --- status ---
  - id: status-running
    when:
      command: status
      state: { sandbox.running: true }
    then:
      output:
        - "NAME    STATE     UPTIME"
        - "web     running   0m2s"

  - id: status-stopped
    when:
      command: status
      state: { sandbox.running: false }
    then:
      output: ["No sandbox is running."]

  # --- logs ---
  - id: logs
    when:
      command: logs
      state: { sandbox.running: true }
    then:
      output: ["[sim] sandbox started"]

  # --- stop ---
  - id: stop
    when:
      command: stop
      state: { sandbox.running: true }
    then:
      state:
        sandbox.running: false
        phase: done
      output: ["Sandbox stopped."]
```

---

## 11. Settings (output streaming)

Optional top-level presentation settings. Streaming is **cosmetic only** — it
never changes *what* is printed, so labs stay deterministic.

```yaml
settings:
  streaming: true       # default true; stream output line-by-line
  streamDelayMs: 20     # per-line delay while streaming (default 20)
  agentThinkMs: 700     # "Evaluating..." spinner before an agent reply (default 700; 0 disables)
```

Before each agent response (in a session or one-shot), a short `Evaluating...`
spinner is shown, then cleared, to make the agent feel more lifelike. It is
cosmetic and only runs while streaming is enabled.

The environment variable `SBX_SIM_STREAM=0` force-disables streaming **and** the
spinner regardless of the manifest; tests and CI set it so output is emitted
instantly.

---

## 12. Agent sessions

Docker Sandboxes launches agentic workloads, so the simulator can run an
**interactive agent session**. It is entirely data-driven: a command scenario
(conventionally `sbx run`) enters a session by declaring a `session` effect.

### 12.1 Entering a session — `then.session`

```yaml
scenarios:
  - id: run
    when: { command: run }
    then:
      output: ["Starting sandbox and agent..."]
      state: { sandbox.running: true }
      session:
        prompt: "agent> "          # REPL input prompt (default "> ")
        intro:                      # printed once when the session starts
          - "Agent ready. Try: \"add a health endpoint\". Type /exit to quit."
        outro:                      # printed once when the session ends
          - "Agent session ended."
```

After applying the scenario's other effects, the simulator prints a built-in
welcome banner (the Docker whale, a title, and a note that the agent is
**simulated/scripted**), then the lab's `intro`, and enters a read-eval loop. It
exits on `/exit`, `/quit`, or end-of-input (Ctrl-D), then prints `outro`. A `run`
scenario with **no** `session` behaves exactly as in 1.0 (no session is entered).

The banner is emitted by the simulator, not the lab, so the "this is scripted"
disclaimer is always present. It is colourised only in interactive (streaming)
mode; with `SBX_SIM_STREAM=0` it is plain text.

### 12.2 Turns — agent scenarios

Each line the learner types is dispatched as a prompt against the **agent
scenarios** (`agent: true`), using `prompt` / `promptContains` + `state`
(§6.3, §6.5), first-match-wins. The matched scenario's effects apply just like a
command: files, state, output, and MCP. State is persisted after every turn, so
a conversation is a state machine.

```yaml
  - id: add-health
    when:
      agent: true
      promptContains: [health, endpoint]
      state: { app.hasHealth: false }
    then:
      output:
        - "Agent: Adding a /health endpoint..."
      files:
        - append: "app/server.js"
          content: "\napp.get('/health', (_, res) => res.sendStatus(200));\n"
      state: { app.hasHealth: true }
```

### 12.3 One-shot mode

`sbx run -p "<prompt>"` (or `--prompt`) fires the `run` scenario, then processes
that single prompt through the agent scenarios and exits — no interactive loop.
`-p`/`--prompt` is a simulator-level flag handled by the CLI, not something
scenarios match on.

### 12.4 Shell mode (`!cmd`)

Inside an interactive session, a line beginning with `!` is a **shell escape**:
everything after the `!` is executed as a real shell command (`sh -c`) with the
lab root as its working directory, mirroring the `!cmd` convention in Claude
Code and other agent CLIs. It lets a learner inspect the actual project without
leaving the session:

```
agent> !ls app
agent> !cat app/server.js
```

A `!cmd` line is first matched against the lab's **shell scenarios**
(`shell: true`, §6.6). If one matches, its scripted effects apply (files, state,
output) exactly like an agent turn, the state is persisted, and the real command
is **not** run — this is how an author mocks an inspection command. If no shell
scenario matches, `!cmd` falls back to running the real process:

Real shell output is genuine process output, not a scripted scenario: it is
never paced or streamed, and it touches no simulator state. A non-zero exit
status is reported to stderr but the session continues. A bare `!` (with no
matching catch-all shell scenario) prints a short usage hint. Shell mode is a
session-only affordance; it does not apply to one-shot `sbx run -p`.

**Web simulator.** The in-browser simulator has no real shell to escape to, so a
`!cmd` that matches no shell scenario reports that host commands are not mocked
(rather than running a process); a matching shell scenario behaves exactly as in
the CLI.

### 12.5 Notes

- Output streams by default (§11); disable with `SBX_SIM_STREAM=0`.
- An unmatched prompt uses `defaults.unmatchedAgent` (§8) and, in a session,
  the loop continues.
- Reset (delete `$SBX_SIM_HOME/`) clears session-accumulated state like any
  other state.

---

## 13. Open questions resolved / deferred

Resolved from `SPEC.md`:

- **`sbx-simulator.yaml` schema** — §3–9 above.
- **Scenario matching** — first-match-wins over an ordered list, ANDing
  `command` + `args` + `state` (§5–6).
- **Prompt matching** — exact string, plus optional `promptContains` keyword
  triggers (§6.3).
- **Agent sessions** — interactive REPL + one-shot, both data-driven (§12).
- **Authoring/testing** — see the implementation-plan doc: a `--check` static
  validator (schema + unreachable-scenario + bad-path lint) plus a scripted
  "drive a sequence of commands and assert state/output" harness. Hot reload
  comes from Labspaces re-running against the same `sbx-simulator.yaml`.
- **Extension points** — commands and agent behavior are pure data: a new `sbx`
  subcommand needs **no engine code** as long as it is expressible as
  output/files/state. Engine code is only touched to add new *matcher* or
  *effect* verbs.

Deferred (noted so we don't design them out):

- Regex/range arg matchers and `state` operators (`>`, `exists`, `contains`).
- Cross-file scenario includes / reusable scenario libraries.
- Conditional/branching output within a single scenario.
- Template-reference lint in `--check` (flag `{{ args.X }}` with no capture).
```
