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

A `simulator.yaml` is referenced from a `labspace.yaml` via its `simulator:`
field. The labspace file owns lab presentation (sections, terminals, seed
files, variables); this file owns command behaviour. See the companion
`labspace.md` specification for the surrounding structure — in particular, the
initial virtual filesystem is seeded by the labspace's `files:` map, and the
terminal ids referenced by `when.terminal` (§6.6) are declared in the
labspace's `terminals:` list.

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

compatibility:            # OPTIONAL. Informational compatibility hints.
  simulator: ">=2.0"      #   Parsed and carried on the Lab, but not enforced.

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

settings: { ... }         # OPTIONAL. Presentation settings. See §13.

defaults: { ... }         # OPTIONAL. Cross-scenario defaults. See §8.

controls: [ ... ]         # OPTIONAL. Learner-facing toggle panel. See §11.

workflows: [ ... ]        # OPTIONAL. CI workflow catalog. See §15.

scenarios: [ ... ]        # REQUIRED. Ordered list. See §5–7.
```

Field summary:

| Field           | Required | Purpose                                          |
| --------------- | -------- | ------------------------------------------------ |
| `version`       | yes      | Schema version; engine validates against         |
| `compatibility` | no       | Version hints; parsed but not enforced (only `version`'s major is checked) |
| `metadata`      | no       | Catalog + display info (opaque to the engine)    |
| `objectives` | no       | Author/Labspaces display only                    |
| `state`      | no       | Seed for the state store (empty tree if omitted) |
| `settings`   | no       | Output streaming/pacing (§13)                    |
| `defaults`   | no       | Fallbacks applied when no scenario matches (§8)  |
| `controls`   | no       | Toggle panel wired to state variables (§11)      |
| `workflows`  | no       | Reusable CI workflow definitions (§15)           |
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
    completes: run-container # OPTIONAL. Marks a step done when this fires. §5.1
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

### 5.1 `completes` — progress step tag

`completes: <step-id>` optionally ties a scenario to a **step** declared in a
section's `steps:` catalog in `labspace.yaml` (see `labspace.md` §5.2). When the
scenario fires, the app marks that step complete — a strong "the learner did it"
signal, because firing is already gated on the right command **and** the right
state.

- Optional and additive; unknown to the matching algorithm (it never affects
  which scenario fires). A scenario with no `completes:` records nothing.
- The engine only *reports* the completed step id on the command outcome;
  recording, persistence, and any telemetry happen in the app layer, so the
  engine stays pure and deterministic.
- Works identically for command and agent (`when.agent`) scenarios.
- `npm run validate-lab` errors on a `completes:` naming a step id that no
  section catalogs, and warns on a cataloged step no scenario completes.

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
  terminal: agent          # only match commands from this terminal id (§6.6)
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
in a session REPL (§14). Command scenarios are never matched against agent
prompts; `command` and `agent` are mutually exclusive.

An agent scenario with **neither** `prompt` nor `promptContains` is a catch-all
for any prompt — place it last.

### 6.5 `state` — preconditions

Map of dot-path → expected value. Semantics are **equality**. A missing key
compares as its zero value (`null`/absent), so `docker.running: false` matches
both an explicit `false` and an unset key.

### 6.6 `terminal` — terminal scoping

A labspace can declare **multiple terminal tabs** (see `labspace.md`), all
sharing one simulator instance (one state tree, one filesystem). `terminal`
restricts a scenario to commands typed in a specific terminal:

```yaml
when:
  command: docker agent
  terminal: agent          # only fires in the terminal whose id is "agent"
```

Semantics:

- The value is the `id` of a terminal declared in `labspace.yaml`.
- **Omitted** (the default) means the scenario matches commands from **any**
  terminal.
- Present means the scenario matches **only** when the command came from that
  terminal id; a command from any other terminal skips this scenario.

`terminal` applies to both command and agent scenarios. Because all terminals
share state and filesystem, a change made in one terminal is immediately
visible in the others — like two shells on the same machine.

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
  session: { ... }   # optional: enter an interactive agent session, §14
  ci: { ... }        # optional: trigger a mock CI workflow run, §15
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

**Pacing an output entry.** Each entry is normally a bare string, printed at the
default streaming cadence. To make simulated work (a pull, a build, a scan) feel
like it takes a moment, an entry can instead be an **object** carrying a cosmetic
`delay`:

```yaml
output:
  - "Unable to find image 'nginx:latest' locally"
  - { text: "latest: Pulling from library/nginx", delay: short }
  - { text: "a480a496...: Pull complete", delay: 900 } # raw milliseconds
  - { delay: long } # a pure pause — waits, prints nothing
  - "Status: Downloaded newer image for nginx:latest"
```

- `delay` is the wait **before** this line appears. It is either a raw
  millisecond count or the **name of a pace profile** declared in
  `settings.pace` (§13). Built-in profiles `short` / `medium` / `long` are always
  available.
- An object with **no `text`** (just a `delay`) is a **pure pause**: the terminal
  waits, then renders nothing. Use it to hold a beat before a block appears.
- `text` supports templating (§7.4) exactly like a bare string.

Pacing is **cosmetic only** — like line streaming (§13), it never changes *what*
is printed, so labs stay deterministic. When `settings.streaming` is `false`, all
delays collapse to zero. The same applies to `stderr`.

### 7.4 Templating

Output, `content`, and `with` support `{{ }}` interpolation:

- `{{ args.<name> }}` — a captured argument value (captured when matched by
  scalar equality, `any`, or `oneOf`). **Flag captures are referenced by their
  name with any leading dashes stripped** — a `--name` matcher is read as
  `{{ args.name }}`, a `-t` matcher as `{{ args.t }}`. (The template grammar has
  no dashes, and flags are stored dash-stripped, so the two stay consistent.)
  Positional captures keep their numeric index: `{{ args.0 }}`.
- `{{ state.<dot.path> }}` — a value from the **post-delta** state.

```yaml
when:
  command: docker run
  args:
    --name: { any: true }
then:
  output:
    - "Starting container '{{ args.name }}'..."   # note: no dashes
  state:
    container.name: "{{ args.name }}"
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

## 11. `controls` — learner-facing toggle panel

`controls` is an optional top-level list that defines toggles shown in the
**Settings** dialog next to the Reset button. Each toggle wires a UI switch to
a state variable, letting learners flip lab behaviour (e.g. enabling a network
policy, unlocking a feature flag) without running commands.

```yaml
controls:
  - id: network-example-com          # REQUIRED. Unique slug; used internally.
    label: "Enable access to example.com"   # REQUIRED. Shown in the dialog.
    description: "Allows scenarios that require example.com to be reachable."  # OPTIONAL
    state: network.exampleDomainAllowed     # REQUIRED. Dot-path to write.
    enabled: true                    # Value written when toggle is ON  (default: true)
    disabled: false                  # Value written when toggle is OFF (default: false)
```

### How controls interact with state

- **Initial position**: the toggle is ON when the current value at `state` is
  JSON-equal to `enabled`; otherwise it starts OFF. The initial state comes
  from the lab's `state:` seed, so the author controls the default position.
- **Toggle action**: flipping the switch immediately calls `setControl(state,
  value)` in the engine — the state store is updated synchronously before the
  next command is matched.
- **Reset**: pressing Reset re-seeds the full state from the manifest, which
  also restores all toggle positions to their initial state.

### `enabled` / `disabled` values

Both fields accept any `StateValue` — boolean, number, string, or null. The
most common pattern is `true` / `false`, but you can write any JSON-serializable
value:

```yaml
controls:
  - id: tier
    label: "Use Pro tier"
    state: account.tier
    enabled: "pro"
    disabled: "free"
```

### Full example

```yaml
state:
  network:
    exampleDomainAllowed: false

controls:
  - id: network-example-com
    label: "Enable network access to example.com"
    description: "Allows scenarios that require example.com to be reachable."
    state: network.exampleDomainAllowed
    enabled: true
    disabled: false

scenarios:
  - id: curl-allowed
    when:
      command: curl
      state: { network.exampleDomainAllowed: true }
    then:
      output: ["<!DOCTYPE html>..."]

  - id: curl-blocked
    when:
      command: curl
    then:
      stderr: ["curl: (7) Failed to connect: network policy blocks this domain."]
      exit: 7
```

When the learner flips the toggle ON, `network.exampleDomainAllowed` is set to
`true`; the next `curl` command matches `curl-allowed`. Flipping it OFF sets
the value back to `false` and the next `curl` matches `curl-blocked`.

### Control fields

| Field         | Required | Type         | Description                               |
| ------------- | -------- | ------------ | ----------------------------------------- |
| `id`          | yes      | string       | Unique slug (used internally)             |
| `label`       | yes      | string       | Human-readable name shown in the dialog   |
| `description` | no       | string       | Optional sub-label with more context      |
| `state`       | yes      | dot-path     | State variable this toggle writes to      |
| `enabled`     | no       | StateValue   | Value when ON (default `true`)            |
| `disabled`    | no       | StateValue   | Value when OFF (default `false`)          |

---

## 12. Worked example — Docker container lifecycle

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

## 13. Settings (output streaming & pacing)

Optional top-level presentation settings. Streaming and pacing are **cosmetic
only** — they never change *what* is printed, so labs stay deterministic.

```yaml
settings:
  streaming: true       # default true; stream output line-by-line
  streamDelayMs: 20     # per-line delay while streaming (default 20 ms)
  agentThinkMs: 700     # "Evaluating..." spinner before agent replies (default 700 ms; 0 disables)
  pace:                 # named pace profiles for output-entry `delay:` (§7.3)
    short: 250          #   (these are the built-in defaults; override or add any)
    medium: 700
    long: 1400
```

### Pace profiles

`settings.pace` is a map of **profile name → milliseconds**. An output entry's
`delay` (§7.3) may name one of these instead of a raw number, so a lab tunes its
"beats" in one place — change `medium` once and every `delay: medium` retunes.

- The built-in profiles `short` (250 ms), `medium` (700 ms), and `long` (1400 ms)
  are always available, even with no `settings.pace` block.
- Author-declared names are **merged over** the defaults, so you can retune a
  built-in (`short: 150`) or add domain profiles (`pull: 900`, `scan: 1400`).
- A `delay` naming a profile that doesn't exist is an authoring error, flagged by
  `npm run validate-lab`.

When `streaming` is `false`, every per-line delay and pause collapses to zero —
the whole transcript renders at once (as it does in the export/print view).

---

## 14. Agent sessions

A command scenario can enter an **interactive agent REPL** by declaring a
`session` effect. This is entirely data-driven.

### 14.1 Entering a session — `then.session`

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

### 14.2 Turns — agent scenarios

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

### 14.3 One-shot mode

Pass `-p "<prompt>"` (or `--prompt`) on a command that opens a session to run
a single agent turn and exit without entering the REPL. This is handled by
the terminal component, not the scenario engine.

### 14.4 Shell commands inside a session (`!cmd`)

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

## 15. CI workflows (`workflows` + `then.ci`)

Labs that teach CI concepts (image signing, policy enforcement, scanning) can
mock a pipeline. When a labspace enables the CI feature (see `labspace.md`), a
**CI tab** appears in the right-hand pane and shows workflow runs. A scenario
fires a run with a `then.ci` effect — typically on a `git push`.

The model has two parts: a reusable **workflow catalog** (`workflows:`) and a
per-scenario **trigger** (`then.ci`) that references a workflow and overrides
the outcome for that run. This keeps the common "push fails → fix → push
succeeds" flow easy: the steps are defined once, and each push only states its
conclusion.

### 15.1 `workflows` — the catalog

A top-level list of reusable workflow definitions.

```yaml
workflows:
  - id: build-and-sign          # REQUIRED, unique. Referenced by `then.ci.workflow`.
    name: "Build and Sign"      # OPTIONAL display name (defaults to `id`).
    on: push                    # OPTIONAL cosmetic trigger label (default "push").
    steps:                      # Ordered steps, each with condensed default logs.
      - id: build
        name: "Build image"
        logs:
          - "$ docker build -t app ."
          - "=> exporting to image ... done"
      - id: login
        name: "Log in to the registry"
        requires: registry.configured   # OPTIONAL. State path that must be truthy.
        logs:                            # shown when the step succeeds
          - "$ docker login"
          - "Login Succeeded"
        failure:                         # OPTIONAL. Shown when `requires` is unmet.
          error: "Login failed — no registry credentials configured."
          logs:
            - "$ docker login"
            - "Error: credentials are not set"
      - id: sign
        name: "Sign image with cosign"
        logs:
          - "$ cosign sign app@sha256:9f8e7d6c"
          - "Pushed signature to registry"
```

| Field         | Required | Purpose                                                     |
| ------------- | -------- | ----------------------------------------------------------- |
| `id`          | yes      | Unique id, referenced by `then.ci.workflow`                 |
| `name`        | no       | Display name (defaults to `id`)                             |
| `on`          | no       | Cosmetic trigger label shown in the run header              |
| `steps`       | no       | Ordered steps (fields below)                                |

Each step has:

| Step field    | Required | Purpose                                                     |
| ------------- | -------- | ----------------------------------------------------------- |
| `id`          | yes      | Unique within the workflow                                  |
| `name`        | no       | Display name (defaults to `id`)                             |
| `logs`        | no       | Condensed log lines shown when the step succeeds            |
| `requires`    | no       | A **state dot-path** that must be truthy for the step to pass |
| `failure`     | no       | `error` + `logs` surfaced when `requires` is unmet          |

Step `logs` are the **condensed, teaching-focused** output — not a full build
log. Keep them short and highlight the concept the lab is about.

`requires` makes a step's outcome depend on the environment rather than on which
command was typed. When a run's conclusion is **not** scripted (a `then.ci` with
no `conclusion`, §15.2), the engine evaluates each step's `requires` against the
current state: the first step whose path is falsy fails the run, showing its
`failure.logs`/`failure.error`; steps with no `requires` always pass. This is
what lets the CI panel's **Re-run** button (§15.4) reflect a setting the learner
just changed — no second push needed.

### 15.2 `then.ci` — triggering a run

A scenario triggers a run by referencing a workflow and declaring its outcome:

```yaml
scenarios:
  - id: push-unsigned
    when:
      command: git push
      state: { signing.configured: false }
    then:
      output: ["To github.com:acme/app.git", "   a1b2c3d..e4f5a6b  main -> main"]
      ci:
        workflow: build-and-sign     # REQUIRED. A workflow id from the catalog.
        commit: "Add signing workflow" # OPTIONAL. Commit label in the run header.
        conclusion: failure          # OPTIONAL. success | failure. Omit to derive from state (§15.1).
        failedStep: sign             # OPTIONAL. Which step fails (default: last step).
        steps:                       # OPTIONAL. Per-run log overrides, matched by step id.
          - id: sign
            logs:
              - "$ cosign sign app@sha256:9f8e7d6c"
              - "Error: no signing key configured"
        error: "Image signing failed — no signing key is configured."
```

| Field         | Required | Purpose                                                    |
| ------------- | -------- | ---------------------------------------------------------- |
| `workflow`    | yes      | The `id` of a workflow in the `workflows:` catalog         |
| `commit`      | no       | Commit label shown in the run header                       |
| `conclusion`  | no       | `success` or `failure`. **Omit** to derive it from state (§15.1) |
| `failedStep`  | no       | Step id that fails when `conclusion: failure` (default: last step) |
| `steps`       | no       | Per-run step overrides (`logs`, `name`), matched by step id |
| `error`       | no       | Error message surfaced on the run when it fails            |

**Two ways to set the outcome:**

- **Scripted** — set `conclusion` explicitly. `failure` fails at `failedStep`
  (or the last step); `success` passes every step. Use this when the outcome is
  fixed regardless of state.
- **State-derived** — omit `conclusion`. The engine evaluates the workflow
  steps' `requires` conditions (§15.1) against the current state to decide
  pass/fail. This keeps the "push fails → fix config → re-run succeeds" flow in
  a **single** scenario, and is what a **Re-run** (§15.4) re-evaluates.

Failure model: steps **before** the failed step succeed, the failed step fails,
and steps **after** it are skipped — the natural CI failure model. On success,
every step succeeds. An unknown `workflow` id is a hard error, surfaced to the
learner as the command's output.

### 15.3 Where runs are stored — `state.ci.runs`

The engine resolves each `then.ci` into a **fully-determined run record** and
appends it to the reserved-by-convention list `state.ci.runs`. A run record has:

```yaml
id: 1                    # 1-based run number (the list length at trigger time)
workflowId: build-and-sign       # catalog id (used to re-run, §15.4)
workflow: "Build and Sign"
event: push
commit: "Add signing workflow"   # or null
conclusion: failure              # success | failure
error: "…"                       # or null
steps:
  - { id: build, name: "Build image", status: success, logs: [ ... ] }
  - { id: sign,  name: "Sign image",  status: failure, logs: [ ... ] }
  - { id: verify, name: "Verify",     status: skipped, logs: [ ... ] }
```

Because a run is just state, it is deterministic (no time, no randomness) and it
is **cleared by Reset** along with the rest of the state. The CI panel *replays*
the newest run cosmetically (queued → in-progress → per-step → conclusion); the
timeline is presentation only, exactly like output streaming (§13), and never
changes what is shown.

### 15.4 Re-running a run — the CI panel's Re-run button

Each run in the CI panel has a **Re-run jobs** button, mirroring GitHub Actions.
Pressing it re-triggers the run's `workflowId` with **no scripted conclusion**,
so the outcome is re-derived from the **current** state (§15.2) and appended as a
new run (carrying the same `commit` label). No command is executed.

This is the idiomatic way to recover from a config-gated failure: the learner
flips a control (e.g. enabling secrets), presses **Re-run**, and the same
pipeline goes green — no artificial "push again with nothing to commit." For it
to work, the pass/fail must be **state-derived**, so gate the relevant step with
`requires` (§15.1) rather than scripting `conclusion` on the trigger.

---

## 16. Open questions / deferred

- Regex/range arg matchers and `state` operators (`>`, `exists`, `contains`).
- Cross-file scenario includes / reusable scenario libraries.
- Conditional/branching output within a single scenario.
- ~~Template-reference lint (flagging `{{ args.X }}` with no capture).~~
  Implemented by `app/scripts/validate-lab.ts` (`npm run validate-lab`), which
  also flags `{{ state.X }}` references nothing writes and unreachable markdown
  commands. A full state-threaded playthrough lint is still deferred.
