# Docker Sandboxes Learning Runtime

A reusable platform for building deterministic, interactive learning experiences
that teach Docker Sandboxes workflows — without requiring production
infrastructure, AI API keys, or organizational permissions.

Labs run inside a Docker Sandbox, using this project as the template image. 
Authors write a scenario file and instructional content; learners get a browser-
based environment with a working terminal, guided instructions, and a simulated 
`sbx` CLI that responds predictably every time.

## Why a simulator?

Real `sbx` workflows depend on AI providers, Docker Hub organizations, API keys,
and network connectivity — none of which a learner can be guaranteed to have.
Generative AI is also non-deterministic: the same prompt produces different
output every time, which makes for a poor educational experience.

The simulator removes all of those dependencies. It replaces the `sbx` binary
inside the sandbox image with a config-driven state machine: every command is
matched against author-declared scenarios and produces the exact same output,
file changes, and state transitions — every time, on any machine, with no
external services required. Learners experience realistic `sbx` workflows;
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
```

## Components

### `interface`

A Go API server and React frontend that together serve the Labspace UI: rendered
instructional content, a browser-based terminal (xterm.js over WebSocket), and
HTTP endpoints for running commands and saving files. It reads a
`labspace.yaml` from the sandbox at `/home/agent/labspace/instructions/`.

### `sbx-simulator`

A config-driven, filesystem-backed state machine that replaces the real `sbx`
CLI inside the sandbox image. Each lab ships a `sbx-simulator.yaml` declaring
scenarios: when a command matches a scenario, the simulator applies its
defined output, file mutations, and state changes — same input, same result,
every time. No AI providers, no network, no Docker Hub required.

See [`sbx-simulator/docs/scenario-spec.md`](sbx-simulator/docs/scenario-spec.md)
for the full authoring reference.

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

1. Write a `sbx-simulator.yaml` with scenarios for each `sbx` command the
   learner will run. Validate it with `sbx --check`.
2. Write a `labspace.yaml` describing the lab sections and instructions.
3. Package both into a Docker image layered on top of the sandbox template.
4. Publish via the kit spec in `kit/spec.yaml`.

See [`sbx-simulator/README.md`](sbx-simulator/README.md) and
[`interface/README.md`](interface/README.md) for per-component details.
