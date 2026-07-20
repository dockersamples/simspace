# Docker Sandboxes Learning Runtime

A reusable platform for building deterministic, interactive learning experiences
— without requiring production infrastructure, AI API keys, or organizational
permissions.

Authors write a scenario file and instructional content; learners get a browser-
based mock terminal that responds to any command predictably, every time.

## Why a simulator?

Real CLI workflows depend on AI providers, Docker Hub organizations, API keys,
and network connectivity — none of which a learner can be guaranteed to have.
Generative AI is also non-deterministic: the same prompt produces different
output every time, which makes for a poor educational experience.

The simulator removes all of those dependencies. It is a config-driven,
in-memory state machine: every command is matched against author-declared
scenarios and produces the exact same output, file changes, and state
transitions — every time, on any machine, with no external services required.
Any command can be simulated (`docker run`, `kubectl apply`, `git push`, …);
authors control exactly what happens.

## Repository layout

```
Dockerfile          multi-stage build for the sandbox template image
go.work             Go workspace linking both modules
kit/
  spec.yaml         sandbox kit definition (image + entrypoint)
interface/
  api/              Go API server — serves the labspace UI and terminal
  client/           React/Vite frontend
sbx-simulator/
  cmd/sbx/          entrypoint for the simulated sbx CLI
  manifest/         sbx-simulator.yaml schema and command matchers
  engine/           scenario matching, effect application, templating
  state/            filesystem-backed state store
  docs/             scenario authoring spec
  testdata/labs/    example labs
sbx-simulator-web/
  src/engine/       TypeScript port of the simulator scenario engine
  src/react/        <SbxTerminal> component
  src/demo/         Vite demo playground
```

## Components

### `interface`

A Go API server and React frontend that together serve the Labspace UI: rendered
instructional content, a browser-based terminal (xterm.js over WebSocket), and
HTTP endpoints for running commands and saving files. It reads a
`labspace.yaml` from the sandbox at `/home/agent/labspace/instructions/`.

### `sbx-simulator-web`

A browser-based React terminal that runs labs from a `simulator.yaml` spec —
no binary, no server, no network. Authors define scenarios for any command;
learners type them in an in-browser terminal powered by a first-match-wins
scenario engine. Built-in `ls` and `cat` automatically reflect the virtual
filesystem. A Vite demo playground (`npm run dev`) lets authors edit a spec
and watch state update live.

See [`sbx-simulator-web/README.md`](sbx-simulator-web/README.md) for usage,
props, and the exported headless engine.

See [`sbx-simulator/docs/scenario-spec.md`](sbx-simulator/docs/scenario-spec.md)
for the full `simulator.yaml` authoring reference.

## Building

Both Go modules can be tested together from the workspace root:

```bash
go test ./...
go vet ./...
```

Build the sandbox template image (builds both binaries and the React client):

```bash
docker build .
```

The `sbx-build` stage compiles the simulator, the `api-build` stage compiles
the interface server, and the final sandbox stage assembles them into the
`docker/sandbox-templates:shell-docker` base image.

## Authoring a lab

1. Write a `simulator.yaml` with scenarios for each command the learner will
   run. See [`sbx-simulator/docs/scenario-spec.md`](sbx-simulator/docs/scenario-spec.md)
   for the full schema reference.
2. Write a `labspace.yaml` describing the lab sections and instructions.
3. Embed the spec in your lab's React/HTML page via `<SbxTerminal spec={...} />`.

See [`interface/README.md`](interface/README.md) for the Labspace UI details.
