# Terminal Simulator — `simulator.yaml` Specification

**Status:** Draft **Schema version:** 2.0

> **2.0 is a clean break from 1.x.** The simulator is now a general-purpose
> web-only mock terminal: any command can be simulated, not just `sbx`
> subcommands. `shell: true` scenarios are removed — those scenarios are
> now written as regular `command:` scenarios. Built-in `ls` and `cat`
> commands reflect the virtual filesystem automatically without any scenario.
> The Go CLI binary is not part of the v2.0 story.

This document specifies the `simulator.yaml` file that authors write to define
a lab. It is the contract between the lab author and the terminal simulator engine.

---

## 1. Core model

The simulator is an **in-memory state machine** driven by a YAML spec. Every
command the learner types is matched against author-declared scenarios and
produces the exact same output, file changes, and state transitions — every
time, on any machine, with no external services required.

```
                   ┌───────────────────────────────────────────────┐
   $ docker run    │ 1. check built-in commands (ls, cat, …)        │
        ─────────► │ 2. find FIRST scenario whose `when` matches    │
                   │    (command + args + current state)            │
                   │ 3. apply `then`: output, files, state deltas   │
                   │ 4. if no match: unmatched default              │
                   └───────────────────────────────────────────────┘
```

Key properties:

- **State is the source of truth.** Every scenario match is gated on, and every
  effect mutates, an in-memory state tree. "Where am I in the lab right now?" is
  answered entirely by state facts.
- **Determinism.** Given the same state and the same command line, the same
  scenario always fires. No time, no randomness, no network, no LLM.
- **First-match-wins, in author order.** Authors put specific cases before
  general fallbacks.
- **Scenarios win over built-ins.** Built-in commands (`ls`, `cat`) only fire
  when no scenario matches; a `command: ls` scenario always takes priority.

---

## 2. State store

State is an in-memory tree of arbitrary keys, reset to the manifest's `state:`
seed each time the lab is initialized or the **Reset** button is pressed. It is
not persisted to disk.

Scenarios read/write state with **dot-paths** (`docker.running`, `phase`). The
engine maintains one reserved key automatically:

- `history` — an append-only list of the raw command lines executed.

---

## 3. Top-level `simulator.yaml` shape

```yaml
version: "2.0"            # REQUIRED. Scenario schema version.

metadata:                 # OPTIONAL. Human/catalog info.
  id: docker-basics
  title: "Docker Basics"
  summary: "Pull, run, and manage Docker containers."
  authors: ["Author Name"]

objectives:               # OPTIONAL. Shown by Labspaces; not used by the engine.
  - "Pull an image with `docker pull`"
  - "Run a container"
  - "Inspect running containers"

state: { ... }            # OPTIONAL. Initial runtime state. See §4.

settings: { ... }         # OPTIONAL. Presentation settings. See §11.

defaults: { ... }         # OPTIONAL. Cross-scenario defaults. See §8.

scenarios: [ ... ]        # REQUIRED. Ordered list. See §5–7.
```

Field summary:

| Field        | Required | Purpose                                          |
| ------------ | -------- | ------------------------------------------------ |
| `version`    | yes      | Schema version; engine validates against         |
| `metadata`   | no       | Catalog + display info (opaque to the engine)    |
| `objectives` | no       | Author/Labspaces display only                    |
| `state`      | no       | Seed for the state store (empty tree if omitted) |
| `settings`   | no       | Output streaming/pacing (§11)                    |
| `defaults`   | no       | Fallbacks applied when no scenario matches (§8)  |
| `scenarios`  | yes      | The ordered match rules                          |

---

## 4. `state` — initial runtime state

Any keys are allowed; these are conventional:

```yaml
state:
  docker:
    running: false
  phase: start
```

---

## 5. Scenario object

```yaml
scenarios:
  - id: docker-run         # REQUIRED, unique. Used in errors/traces.
    description: "..."     # OPTIONAL, author note.
    when: { ... }          # REQUIRED. Match conditions. §6
    then: { ... }          # REQUIRED. Effects.          §7
```

Matching algorithm (per command):

1. Iterate `scenarios` **top to bottom**.
2. The first scenario whose **entire** `when` is satisfied by the current
   command line **and** current state is selected.
3. Its `then` is applied.
4. If none match and the command is a built-in (`ls`, `cat`), the built-in
   runs against the virtual filesystem.
5. If none match and no built-in applies, the engine uses `defaults.unmatched` (§8).

---

## 6. `when` — match conditions

All present conditions must hold (logical AND). Omitted conditions are ignored.

```yaml
when:
  command: docker run      # full command prefix. String or list.
  args:                    # arg/flag matchers (see below)
    --name: { any: true }
  agent: true              # match an agent prompt, not a command (§6.4)
  prompt: "add a /health…" # EXACT prompt string (§6.3)
  promptContains: [health] # OR keyword triggers (§6.3)
  state:                   # state preconditions (dot-path -> expected)
    docker.running: false
```

A scenario is either a **command scenario** (matched against a typed command)
or an **agent scenario** (`agent: true`, matched against a prompt typed in a
session). `command` and `agent` are mutually exclusive.

### 6.1 `command` — the command prefix

The leading tokens of the command line, as an ordered path. Accepts a
**space-joined string** or a **list**; these are equivalent:

```yaml
command: docker run
command: "kubectl apply -f"
command: [git, commit]
```

Matching is on the leading tokens only; positional values and flags are matched
via `args`. A bare `command:` with no `args:` matches that prefix regardless
of trailing arguments.

### 6.2 `args` — argument matchers

`args` is a map of name → matcher. Names are either flag names (with or without
leading dashes) or integer positional indices (0-based, relative to the tokens
after the command path):

```yaml
args:
  --name: "web"        # scalar: equals (string compare)
  -d: true             # boolean: flag is present
  --rm: false          # boolean: flag is absent
  --tag:               # object matcher:
    any: true          #   present with any value (also captures it)
  0:                   # positional: first token after the command path
    oneOf: ["nginx", "redis"]
```

Matchers:

| Syntax              | Kind      | Matches when                               |
| ------------------- | --------- | ------------------------------------------ |
| `name: "value"`     | equals    | flag/arg present and equal to that string  |
| `name: true`        | present   | flag/arg is present (any value)            |
| `name: false`       | absent    | flag/arg is not present                    |
| `name: { any: true }` | any     | present with any value; captures the value |
| `name: { oneOf: [..] }` | oneOf | present and value is in the set; captures  |

### 6.3 `prompt` / `promptContains` — prompt matching

Used in **agent scenarios** to match the typed prompt:

- `prompt: "<text>"` — **exact string equality** after trimming whitespace.
- `promptContains: [a, b]` — matches when the prompt contains *every* listed
  substring, case-insensitively.

In a **command scenario**, `prompt` matches the positional tokens after the
command path, joined. Use it for simple one-argument commands:

```yaml
when:
  command: docker pull
  prompt: "nginx:latest"   # matches: docker pull nginx:latest
```

### 6.4 `agent` — agent prompt dispatch

`agent: true` marks an **agent scenario**, matched only against prompts typed
in a session REPL (§12). Command scenarios are never matched against agent
prompts; `command` and `agent` are mutually exclusive.

An agent scenario with **neither** `prompt` nor `promptContains` is a catch-all
for any prompt — place it last.

### 6.5 `state` — preconditions

Map of dot-path → expected value. Semantics are **equality**. A missing key
compares as its zero value (`null`/absent), so `docker.running: false` matches
both an explicit `false` and an unset key.

---

## 7. `then` — effects

Applied in a fixed order: **files → state → output → exit**. (Files first so
output can describe what changed; state before output so templated output can
read the new values.)

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

An ordered list of single-key operations. Paths are relative to the lab root
and are tracked in the virtual in-memory filesystem.

```yaml
files:
  - mkdir: "logs"
  - create: "app/server.js"          # create/overwrite with content
    content: |
      const express = require('express');
      app.listen(3000);
  - append: "app/server.js"          # append content to end
    content: "\n// added by agent\n"
  - replace: "app/server.js"         # substring replacement
    find: "PORT = 3000"
    with: "PORT = 8080"
  - delete: "tmp/cache"              # remove file or directory tree
  - copy: "app/server.js"            # copy within the virtual FS
    to: "app/server.bak"
```

A `replace` whose `find` is absent is a hard error (fails fast so authoring
mistakes surface immediately). `content` and `with` support templating (§7.4).

Files written by scenarios are immediately visible to the built-in `ls` and
`cat` commands (§10).

### 7.2 `state` — state deltas

Map of dot-path → new value. Sets (creating intermediate objects as needed).

```yaml
state:
  docker.running: true
  phase: running
```

List append uses the `+=` suffix:

```yaml
state:
  docker.events += "started"
```

### 7.3 `output` / `stderr`

Ordered list of lines written verbatim (plus trailing newline). Templating
(§7.4) applies.

```yaml
output:
  - "Pulling image '{{ args.0 }}'..."
  - "Status: Image is up to date for {{ args.0 }}"
```

### 7.4 Templating

Output, `content`, and `with` support `{{ }}` interpolation:

- `{{ args.<name> }}` — a captured argument value (captured when matched by
  scalar equality, `any`, or `oneOf`).
- `{{ state.<dot.path> }}` — a value from the **post-delta** state.

```yaml
when:
  command: docker run
  args:
    --name: { any: true }
then:
  output:
    - "Starting container '{{ args.--name }}'..."
  state:
    container.name: "{{ args.--name }}"
```

No logic, loops, or expressions — substitution only.

---

## 8. `defaults`

```yaml
defaults:
  unmatched:                   # applied when NO command scenario matches
    stderr:
      - "command not found — this command is not simulated in this lab."
    exit: 127
  unmatchedAgent:              # applied when NO agent scenario matches a prompt
    output:
      - "Agent: I'm not sure how to help with that in this lab."
  exit: 0                      # default exit code for scenarios that omit it
```

`defaults.unmatched` is only reached after all scenarios fail **and** no
built-in command applies. To override the default error message without
defining a full scenario, set `defaults.unmatched`.

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

Governance can gate MCP: if `state.mcp.enabled` is false, author a
higher-priority scenario that matches and returns a policy message instead.

---

## 10. Built-in commands

Two commands are built in and reflect the virtual filesystem automatically,
without any scenario:

### `ls [path]`

Lists files and directories. Directories are shown with a trailing `/`.

```
$ ls
app/
config.yaml

$ ls app
server.js
utils.js

$ ls app/server.js
app/server.js
```

- `ls` or `ls .` — lists the lab root.
- `ls <dir>` — lists immediate children of that directory.
- `ls <file>` — echoes the file name.
- `ls <missing>` — exits 1 with an error.

### `cat <file> [<file>...]`

Prints file contents. Concatenates multiple files in order.

```
$ cat app/server.js
const express = require('express');
app.listen(3000);

$ cat missing.txt
cat: missing.txt: No such file or directory
```

**Override:** define a `command: ls` or `command: cat` scenario to produce
custom output (e.g. for pedagogical control or to gate the command behind
state). Scenarios always take priority over built-ins.

---

## 11. Worked example — Docker container lifecycle

```yaml
version: "2.0"

metadata:
  id: docker-basics
  title: "Docker Basics"
  summary: "Pull, run, and inspect a Docker container."

state:
  container:
    running: false
  phase: start

defaults:
  unmatched:
    stderr: ["That command isn't part of this lab."]
    exit: 1

scenarios:
  # docker pull
  - id: pull-nginx
    when:
      command: docker pull
      args:
        0: { any: true }
    then:
      output:
        - "Using default tag: latest"
        - "latest: Pulling from library/{{ args.0 }}"
        - "Status: Downloaded newer image for {{ args.0 }}:latest"

  # docker run
  - id: run-container
    when:
      command: docker run
      args:
        --name: { any: true }
        -d: true
      state: { container.running: false }
    then:
      state:
        container.running: true
        container.name: "{{ args.--name }}"
      output:
        - "a1b2c3d4e5f6g7h8i9j0"

  - id: run-already-running
    when:
      command: docker run
      state: { container.running: true }
    then:
      stderr: ["docker: Error — container is already running."]
      exit: 1

  # docker ps
  - id: ps-running
    when:
      command: docker ps
      state: { container.running: true }
    then:
      output:
        - "CONTAINER ID   IMAGE   COMMAND   STATUS          NAMES"
        - "a1b2c3d4e5f6   nginx   nginx     Up 2 seconds    {{ state.container.name }}"

  - id: ps-empty
    when:
      command: docker ps
      state: { container.running: false }
    then:
      output: ["CONTAINER ID   IMAGE   COMMAND   STATUS   NAMES"]

  # docker stop
  - id: stop-container
    when:
      command: docker stop
      state: { container.running: true }
    then:
      state:
        container.running: false
      output: ["{{ state.container.name }}"]
```

---

## 12. Settings (output streaming)

Optional top-level presentation settings. Streaming is **cosmetic only** — it
never changes *what* is printed, so labs stay deterministic.

```yaml
settings:
  streaming: true       # default true; stream output line-by-line
  streamDelayMs: 20     # per-line delay while streaming (default 20 ms)
  agentThinkMs: 700     # "Evaluating..." spinner before agent replies (default 700 ms; 0 disables)
```

---

## 13. Agent sessions

A command scenario can enter an **interactive agent REPL** by declaring a
`session` effect. This is entirely data-driven.

### 13.1 Entering a session — `then.session`

```yaml
scenarios:
  - id: agent-start
    when:
      command: docker agent
    then:
      output: ["Starting agent session..."]
      state: { agent.active: true }
      session:
        prompt: "agent> "          # REPL input prompt (default "> ")
        intro:
          - "Agent ready. Ask me to modify the app. Type /exit to quit."
        outro:
          - "Agent session ended."
```

After applying the scenario's effects, the simulator displays a banner (a
whale ASCII art, title, and scripted-environment disclaimer), then `intro`,
and enters the REPL. The session ends on `/exit`, `/quit`, or the Reset
button.

### 13.2 Turns — agent scenarios

Each line the learner types is matched against **agent scenarios** (`agent:
true`) using `prompt` / `promptContains` + `state`, first-match-wins.

```yaml
  - id: add-health
    when:
      agent: true
      promptContains: [health, endpoint]
      state: { app.hasHealth: false }
    then:
      output:
        - "Adding a /health endpoint..."
      files:
        - append: "app/server.js"
          content: "\napp.get('/health', (_, res) => res.sendStatus(200));\n"
      state: { app.hasHealth: true }
```

State changes persist across turns — a conversation is a state machine.

### 13.3 One-shot mode

Pass `-p "<prompt>"` (or `--prompt`) on a command that opens a session to run
a single agent turn and exit without entering the REPL. This is handled by
the terminal component, not the scenario engine.

### 13.4 Shell commands inside a session (`!cmd`)

Inside a session REPL, a line beginning with `!` runs the text after it
through the **normal command matching engine** — the same first-match-wins
logic as command mode. This lets learners run commands without leaving the
session:

```
agent> !docker ps
agent> !ls app
agent> !cat app/server.js
```

The `!cmd` mechanism is purely a UI concern: the `!` prefix distinguishes
"run a command" from "talk to the agent". The simulator sees `docker ps` (or
`ls app`) and matches it exactly like a top-level command, including built-ins.

To script a specific `!cmd` response, define a normal command scenario:

```yaml
  - id: docker-ps-in-session
    when:
      command: docker ps
      state: { container.running: true }
    then:
      output:
        - "CONTAINER ID   IMAGE   COMMAND   STATUS          NAMES"
        - "a1b2c3d4e5f6   nginx   nginx     Up 5 seconds    web"
```

This scenario fires whether the learner types `docker ps` at the top level or
`!docker ps` inside an agent session.

---

## 14. Open questions / deferred

- Regex/range arg matchers and `state` operators (`>`, `exists`, `contains`).
- Cross-file scenario includes / reusable scenario libraries.
- Conditional/branching output within a single scenario.
- Template-reference lint (flagging `{{ args.X }}` with no capture).
