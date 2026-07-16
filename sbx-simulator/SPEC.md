# SBX Simulator
## Technical Specification

**Status:** Draft

**Version:** 0.1

---

# Overview

The SBX Simulator is a drop-in replacement for the Docker Sandboxes CLI used exclusively in educational environments.

The simulator integrates with Labspaces, which provides:

- Browser UI
- Instructions
- Terminal
- Authoring workflow
- Live reload

The simulator is responsible only for reproducing SBX workflows.

---

# Design Goals

- Deterministic
- Declarative
- Extensible
- Fast
- Educational
- Versioned

---

# Architecture

```text
          Labspaces

 Instructions | Terminal

          │

          ▼

      sbx Simulator

          │

     Scenario Engine

          │

   sbx-simulator.yaml

          │

      Project Files
```

---

# Responsibilities

The simulator is responsible for:

- Parsing SBX commands
- Managing runtime state
- Executing scenarios
- Modifying project files
- Simulating governance
- Simulating MCP
- Producing CLI output

Everything else belongs to Labspaces.

---

# Lab Manifest

Every lab begins with:

```text
sbx-simulator.yaml
```

The manifest describes:

- metadata
- learning objectives
- scenarios
- starter project
- compatibility

The manifest is the contract between Labspaces and the simulator.

---

# Runtime State

Example:

```yaml
sandbox:
  running: false

agent:
  active: false

organization:
  approvalRequired: false

mcp:
  enabled: true

history: []
```

State is the source of truth.

---

# Command Architecture

Each SBX command is implemented independently.

Example:

```text
commands/

run/

stop/

logs/

status/

agent/

policy/

mcp/
```

Each command receives:

- runtime state
- lab manifest
- command arguments

and returns:

- updated state
- output
- events

---

# Scenario Engine

Commands trigger scenarios.

Example:

```yaml
steps:

- when:
    command: sbx run

  then:

    output:

    - Starting sandbox...

    - Connecting agent...

    state:

      sandbox.running: true
```

Scenarios describe behavior rather than implementation.

---

# Agent Simulation

The simulator never executes an LLM.

Instead:

```text
Prompt

↓

Scenario Match

↓

Filesystem Changes

↓

Terminal Output
```

Prompts act as deterministic triggers.

## Interactive Sessions

Docker Sandboxes launches agentic workloads, so the simulator reproduces an
interactive agent session. When a command scenario declares a `session` effect
(conventionally the `sbx run` scenario), the simulator enters a REPL after
applying that scenario's effects:

```text
sbx run
  → apply scenario effects (output, files, state)
  → enter session:
       print intro
       loop:
         read a prompt
         match an agent scenario (agent: true)
         apply effects, stream the response
       until /exit or EOF
       print outro
```

Each REPL turn is dispatched through the same scenario engine as a CLI command,
so agent responses are deterministic: filesystem changes, MCP calls, and output
are authored, not generated. State persists after every turn, so a conversation
is a state machine like everything else.

The same agent scenarios run non-interactively via `sbx run -p "<prompt>"`,
which processes a single prompt and exits. Response output streams by default
for a realistic feel; streaming is cosmetic and can be disabled
(`SBX_SIM_STREAM=0`) so content remains fully deterministic.

---

# Governance

Supported concepts include:

- approvals
- internet access
- model allowlists
- MCP permissions
- registry restrictions

Changing policies immediately affects command behavior.

---

# MCP

The simulator supports mocked MCP interactions.

Example:

```text
Calling tool...

github.search

Arguments:

repo=docker/sandbox

Result:

3 repositories found.
```

No external services are contacted.

---

# Filesystem

The simulator may:

- create files
- modify files
- delete files
- create directories

Learners interact with a real project.

---

# Versioning

Simulator versions are independent.

Example:

```
latest

1.0

1.1

1.2
```

Labs may reference either:

- latest
- pinned versions

---

# Repository Layout

```text
cmd/

engine/

commands/

state/

filesystem/

governance/

mcp/

docs/
```

---

# Engineering Principles

## Configuration over Code

Labs should describe behavior rather than implement behavior.

---

## State is the Source of Truth

Every command derives behavior from runtime state.

---

## Simulation, Not Emulation

Teach workflows.

Do not recreate Docker Sandboxes.

---

## Composable Commands

Each SBX command should be implemented independently.

---

## Fast Feedback

Learners should receive immediate responses.

---

## Optimize for Authors

The simulator should make new labs easy to build.

---

## Transparent Simulation

The simulator should always make it clear that behavior is simulated.

---

# Open Questions

Resolved (see `docs/scenario-spec.md` and `docs/implementation-plan.md`):

- **`sbx-simulator.yaml` schema** — specified.
- **Scenario matching** — first-match-wins over an ordered list, ANDing
  command + args + prompt + state.
- **Prompt matching** — exact string by default, with optional keyword
  (`promptContains`) triggers for phrasing tolerance.
- **Authoring/testing** — `sbx --check` static validator plus golden scripted
  tests.
- **Extension points** — commands and agent behavior are pure data; new SBX
  commands need no engine code when expressible as output/files/state.

Still open:

- Should the simulator support branching/conditional output within one scenario?
- How should long or multi-file starter projects be delivered?
