# SBX Simulator — Implementation Plan

**Status:** Draft **Target:** simulator v1.0, scenario schema v1.0

Companion to `docs/scenario-spec.md`. Language: **Go** (single static binary,
drops into a lab container as `sbx`).

---

## 1. Lifecycle of one command

```
main() → resolve lab root + $SBX_SIM_HOME
       → load state.json (or seed from sbx-simulator.yaml `state:`)
       → parse os.Args into a Command{Path, Args, Prompt}
       → engine.Match(command, state, lab.Scenarios) → *Scenario | nil
       → engine.Apply(scenario.Then | defaults.Unmatched):
             files → state deltas → output/stderr → mcp
       → append command to state.history
       → persist state.json
       → os.Exit(code)
```

Everything above `engine` is thin I/O; all behavior lives in data (`sbx-simulator.yaml`)
interpreted by `engine`.

---

## 2. Repository layout

Follows `SPEC.md`'s layout, concretized for Go:

```
cmd/
  sbx/            main.go — arg parsing, wiring, exit codes
engine/
  match.go        scenario selection (command+args+state, first-match)
  apply.go        effect application in fixed order
  template.go     {{ args.* }} / {{ state.* }} substitution
manifest/
  lab.go          sbx-simulator.yaml structs + YAML load + schema validation
  compat.go       simulator/schema version checks
state/
  store.go        load/seed/persist state.json; dot-path get/set/append
commands/
  parse.go        os.Args → Command{Path, Args map, Prompt}
filesystem/
  ops.go          mkdir/create/append/replace/delete/copy, path sandboxing
governance/
  (v1: no code — governance is pure state + scenarios; folder reserved)
mcp/
  render.go       format then.mcp blocks into sbx-style output
docs/
  scenario-spec.md, implementation-plan.md
testdata/
  labs/…          example labs used by tests
```

`governance/` stays code-free in v1.0 (policies are just state facts scenarios
gate on); the package exists so a future non-data policy engine has a home.

---

## 3. Key types (sketch)

```go
// manifest
type Lab struct {
    Version       string
    Metadata      Metadata
    Compatibility Compat
    Objectives    []string
    State         map[string]any
    Defaults      Defaults
    Scenarios     []Scenario
}
type Scenario struct {
    ID   string
    When When
    Then Then
}
type When struct {
    Command []string            // normalized to a token slice
    Args    map[string]Matcher
    Prompt  *string             // nil = not constrained; exact match if set
    State   map[string]any      // dot-path -> expected
}
type Then struct {
    Files  []FileOp
    State  map[string]any       // dot-path -> value ("+=" suffix = append)
    Output []string
    Stderr []string
    Exit   *int
    MCP    []MCPCall
}

// commands
type Command struct {
    Path   []string             // subcommand tokens, e.g. ["policy","allow","network"]
    Args   map[string]string    // flags + positionals, resolved by name
    Flags  map[string]bool      // presence of boolean flags
    Prompt string               // freeform arg for agent commands
}
```

`engine.Match` returns the first scenario whose `When` is fully satisfied;
`engine.Apply` walks `Then` in the fixed order and returns `(exitCode, error)`.

---

## 4. Path safety

`filesystem/ops.go` must confine every write/delete to the lab root: reject
absolute paths and any path that escapes the root after `filepath.Clean` +
symlink resolution. A scenario must never be able to touch files outside the
learner's project. Covered by unit tests with `../` and symlink attempts.

---

## 5. Authoring & testing story

Three layers, cheapest first:

1. **`sbx --check <sbx-simulator.yaml>`** — static validation, no execution:
   - schema-valid against v1.0 (unknown keys are errors, so typos surface),
   - every `then.files` path is inside the lab root,
   - every `replace` has `find`, every `create`/`append` has `content`,
   - **reachability lint**: warn on scenarios that can never match (e.g. a
     later scenario fully shadowed by an earlier one with identical `when`).
2. **Scripted lab tests** — a small test harness (Go table tests over
   `testdata/labs/`) that drives an ordered list of command lines against a
   fresh state store and asserts resulting `output`, `exit`, and `state`. This
   is how we regression-test both the engine and shipped example labs.
3. **Live authoring** — Labspaces hot-reloads by re-running `sbx` against the
   edited `sbx-simulator.yaml`; reset = delete `$SBX_SIM_HOME/`.

We should ship the "Sandbox Lifecycle" lab from the spec as the first
`testdata` lab and the first golden test.

---

## 6. Versioning

- **Scenario schema version** (`sbx-simulator.yaml: version`) and **simulator version**
  are independent (per SPEC). `manifest/compat.go` checks `compatibility.simulator`
  against the running binary and fails fast with a clear message on mismatch.
- Binary embeds its version via `-ldflags -X`.

---

## 7. Milestones

| # | Milestone | Deliverable | Status |
|---|-----------|-------------|--------|
| M0 | Skeleton | Go module, `cmd/sbx` prints version; repo layout scaffolded | ✅ done |
| M1 | State store | `state/` load/seed/persist + dot-path get/set/append + tests | ✅ done |
| M2 | Parse + match | `commands/parse.go`, `engine/match.go` (command+args+state); table tests | ✅ done |
| M3 | Effects | `engine/apply.go`, `filesystem/ops.go` (all ops, path-safe), templating | ✅ done |
| M4 | End-to-end lab | Ship "Sandbox Lifecycle" lab + golden scripted test | ✅ done |
| M5 | Validator | `sbx --check` (schema + lint + reachability) | ✅ done |
| M6 | MCP + governance examples | `then.mcp` rendering + policy-gated example lab | ✅ done |
| M7 | Packaging | Static build, embedded version, install-as-`sbx` docs | ✅ done |

All v1.0 milestones (M0–M7) are complete: a usable, validated, packaged
simulator. `Makefile` provides build/test/check/install/dist; binaries are
static (`CGO_ENABLED=0`) with the version stamped from git into `sbx
--version`. Install and Labspaces-integration docs are in the top-level
[`README.md`](../README.md).

### M8 — Interactive agent sessions (schema 1.1) — ✅ done

Adds the agentic-session experience (scenario-spec §12). Deliverables:

- **manifest**: `When.Agent` (bool), `When.PromptContains` ([]string),
  `Then.Session` (`*Session{Intro, Prompt, Outro}`), `Lab.Settings`
  (`{Streaming, StreamDelayMs}`), `Defaults.UnmatchedAgent`. Bump
  `SchemaVersion` to `1.1`.
- **engine**: `MatchAgent` (agent-only scenarios, prompt/keyword/state),
  `RunAgent` (dispatch one prompt), and a `Result.Session` signal so the CLI
  knows to enter a REPL. `Match` skips agent scenarios; `MatchAgent` skips
  command scenarios.
- **session/** (new pkg): the REPL loop over `io.Reader`/`io.Writer` (testable
  with a `strings.Reader`) and a streaming writer; `/exit`,`/quit`,EOF end it.
- **cmd/sbx**: enter the session when `Result.Session` is set; `-p/--prompt`
  runs one-shot. Streaming from settings, overridable by `SBX_SIM_STREAM=0`.
- **validate**: error on `command`+`agent` together and `prompt`+`promptContains`
  together; extend reachability to agent scenarios.
- **testdata**: an `interactive-agent` lab + golden session test (streaming off,
  prompts piped through a `strings.Reader`).

Content stays deterministic — streaming is cosmetic and disabled in tests.

The `governance-mcp` lab (`testdata/labs/`) demonstrates approvals, MCP
permissions, and network egress as state gates: an agent run is blocked by
each policy in turn, then succeeds — rendering a mocked MCP call and writing a
findings file. It has a golden end-to-end test and passes `sbx --check`.

`sbx --check [sbx-simulator.yaml]` (package `validate/`) reports schema/structural
errors, file-op and path lints, and a conservative (no-false-positive)
unreachable-scenario detector. Exit 0 = no errors (warnings allowed), 1 = errors.

---

## 8. Dependencies (keep minimal)

- YAML: `sigs.k8s.io/yaml` (or `gopkg.in/yaml.v3`) — decide at M0.
- Semver for compatibility: `golang.org/x/mod/semver` or `Masterminds/semver`.
- No CLI framework needed for v1.0 — hand-rolled parse keeps behavior fully
  under our control (real `sbx` arg quirks are easier to mimic without a
  framework's opinions). Revisit if command surface grows.

---

## 9. First actions when we start coding

1. `go mod init github.com/dockersamples/sbx-simulator` (confirm module path).
2. Scaffold the package layout (M0) with stub types from §3.
3. Land `state/` + tests (M1) — it's the foundation everything gates on.
4. Bring up match+apply against the Sandbox Lifecycle lab (M2–M4) end to end.
```
