# SBX Simulator

A deterministic, config-driven drop-in replacement for the Docker Sandboxes
(`sbx`) CLI, built for **Labspaces** educational labs. It teaches SBX
workflows — sandbox lifecycle, agents, governance, MCP — without touching any
production infrastructure: no AI providers, no API keys, no Docker Hub, no
network.

Each lab is a single `sbx-simulator.yaml` file. The simulator runs it as a
**filesystem-backed state machine**: every command loads persisted state,
matches an author-declared scenario, applies output/file/state effects, and
persists. Same input, same state → same result, every time.

See [`PRD.md`](PRD.md) and [`SPEC.md`](SPEC.md) for the product/technical
background, and [`docs/`](docs/) for the authoring spec and build plan.

## Quick start

```bash
make build          # builds a static ./sbx binary
./sbx --version

# Run a lab: sbx discovers the nearest sbx-simulator.yaml by searching upward from $PWD.
cd testdata/labs/sandbox-lifecycle
/path/to/sbx run
/path/to/sbx status
```

## Build & install

Requires Go 1.25+.

```bash
make build          # -> ./sbx (static, version stamped from git)
make install        # -> $GOBIN/sbx (or $GOPATH/bin)
make dist           # -> ./dist/sbx-<os>-<arch> for linux/darwin/windows
make test           # run the test suite
make check          # validate every shipped example lab
make help           # list all targets
```

Builds are static (`CGO_ENABLED=0`) so the binary runs in minimal lab
containers. The version is stamped from `git describe` into `sbx --version`.

### Installing as `sbx`

The binary is named `sbx`. To make a lab use the simulator instead of the real
CLI, put it on `PATH` ahead of any real `sbx` — typically Labspaces installs it
into the lab container image and no real CLI is present.

## Running a lab

The simulator resolves two things per invocation:

| What                  | How it's resolved                                                             |
| --------------------- | ------------------------------------------------------------------------------ |
| `sbx-simulator.yaml`  | `$SBX_SIM_LAB` if set, else the nearest `sbx-simulator.yaml` searching upward from `$PWD` |
| State store           | `$SBX_SIM_HOME/state.json`, default `<lab-root>/.sbx-sim/`                    |
| Streaming             | on by default; `SBX_SIM_STREAM=0` disables paced output + the agent "Evaluating..." spinner (tests/CI) |

On the first command, state is seeded from the manifest's `state:` block. To
**reset** a lab, run `sbx sim reset` or delete `$SBX_SIM_HOME/` directly
(Labspaces also does this on lab start). Reset is namespaced under `sbx sim`
rather than a top-level command so the real-CLI surface stays a faithful
drop-in.

## Commands

- `sbx <command> [...]` — run a lab command through the scenario engine.
- `sbx run` — if the lab's `run` scenario declares a `session`, this starts an
  interactive agent REPL (type prompts, `/exit` or Ctrl-D to leave).
- `sbx run -p "<prompt>"` — run a single agent prompt non-interactively.
- `sbx sim reset` — reset simulator state (delete `$SBX_SIM_HOME/`) so the lab
  starts fresh. `sbx sim` namespaces simulator-only meta-commands.
- `sbx --version` — print the stamped version.
- `sbx --check [sbx-simulator.yaml]` — statically validate a lab (schema, file-op and
  path lints, unreachable-scenario detection). Exit 0 = no errors (warnings
  allowed), 1 = errors. Use it in CI and while authoring.

## Authoring labs

Write a single `sbx-simulator.yaml`. The full schema — top-level fields, `when` matching
(command + args + exact prompt + state), `then` effects (files, state,
output, MCP), templating, and defaults — is documented in
[`docs/scenario-spec.md`](docs/scenario-spec.md). Two complete examples ship in
[`testdata/labs/`](testdata/labs/):

- `sandbox-lifecycle` — start / status / logs / stop.
- `governance-mcp` — approvals, MCP permissions, and network egress as policy
  gates, ending in an agent run that calls a mocked MCP tool.
- `interactive-agent` — `sbx run` starts a sandbox + agent and drops into an
  interactive session where the learner asks the agent to build features.

Validate as you go with `sbx --check`, and regression-test a command sequence
with a golden test (see `engine/*_test.go`).

## Repository layout

```
cmd/sbx/       entrypoint: lab discovery, load, run, persist, exit
manifest/      sbx-simulator.yaml schema, strict YAML load, command/arg matchers
commands/      argv -> {tokens, flags}
engine/        scenario matching (first-match-wins), effect apply, templating
state/         filesystem-backed state store (dot-path access)
filesystem/    path-confined file operations
mcp/           mocked MCP tool-call rendering
validate/      static `sbx --check` validator
testdata/labs/ shipped example labs + golden tests
docs/          scenario-spec.md, implementation-plan.md
```
