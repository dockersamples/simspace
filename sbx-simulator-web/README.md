# SBX Simulator — Web

An in-browser React terminal that runs [SBX Simulator](../sbx-simulator) labs
directly from their `sbx-simulator.yaml` spec — no Go binary, no server, no
network. It is a faithful port of the simulator's scenario engine to
TypeScript, wrapped in a single `<SbxTerminal>` component.

Give it a lab spec and it renders a terminal where learners type `sbx …`
commands and, when a `sbx run` scenario opens one, chat with a scripted agent.
Same input + same state → same output, every time, just like the CLI.

## What it simulates (and what it doesn't)

- ✅ **The `sbx` command** — the full scenario engine: command/arg/state
  matching, `then` effects (files, state deltas, output, MCP), templating, and
  the `sbx --version` / `sbx sim reset` meta-commands.
- ✅ **Agent prompts** — interactive agent sessions (`then.session`), the
  scripted-agent banner, keyword/exact prompt matching, and one-shot
  `sbx run -p "…"`.
- ✅ **Scripted shell escapes** — inside a session, a `!cmd` line is matched
  against **shell scenarios** (`when.shell: true`) using the same
  `prompt` / `promptContains` matchers as agent prompts, applied to the command
  after the `!`. This lets a lab mock inspection commands like
  `!cat app/server.js` or `!ls app`.
- 🚫 **Host commands** — `ls`, `cat`, and other shell commands are **not** run
  for real. Anything that isn't `sbx` returns a `command not found` message, and
  a session `!cmd` that matches no shell scenario reports that host commands are
  not mocked (there is no real process to run). The one exception is `clear`, a
  terminal built-in that wipes the screen (like a shell's `clear` / Ctrl-L)
  without touching lab state.

Everything runs against an **in-memory** state store and virtual filesystem, so
`then.files` effects (including a `replace` whose `find` is missing failing the
lab) behave exactly as they do on the CLI.

## Usage

```tsx
import { SbxTerminal } from "sbx-simulator-web";

function Lab({ specYaml }: { specYaml: string }) {
  return (
    <SbxTerminal
      spec={specYaml}
      files={{ "app/server.js": "// starter code\n" }}
      onStateChange={(state) => console.log(state)}
      style={{ height: 500 }}
    />
  );
}
```

### Props

| Prop            | Type                                | Default              | Purpose                                                        |
| --------------- | ----------------------------------- | -------------------- | -------------------------------------------------------------- |
| `spec`          | `string`                            | —                    | The `sbx-simulator.yaml` document text. **Required.**          |
| `files`         | `Record<string, string>`            | `{}`                 | Seed the virtual filesystem, keyed by lab-relative path.       |
| `version`       | `string`                            | `"web"`              | Reported by `sbx --version`.                                   |
| `shellPrompt`   | `string`                            | `"$ "`               | Prompt shown in command mode.                                  |
| `streaming`     | `boolean`                           | lab `settings`       | Override line-by-line streamed output.                         |
| `streamDelayMs` | `number`                            | lab `settings` (20)  | Per-line delay while streaming.                                |
| `agentThinkMs`  | `number`                            | lab `settings` (700) | "Evaluating…" spinner duration before agent replies (0 = off). |
| `showHeader`    | `boolean`                           | `true`               | Show the title bar + Reset button.                             |
| `greeting`      | `string[]`                          | derived              | Lines printed once on start (pass `[]` to suppress).           |
| `onStateChange` | `(state) => void`                   | —                    | Called with a fresh state snapshot after every command/turn.   |
| `className`     | `string`                            | —                    | Extra class on the root element.                               |
| `style`         | `React.CSSProperties`               | —                    | Inline style on the root (e.g. to set a height).               |

Changing `spec` (or `files`) rebuilds the simulator and clears the terminal.
The **Reset** button — and typing `sbx sim reset` — re-seed state and files from
the manifest, exactly like deleting `$SBX_SIM_HOME` on the CLI.

### Headless engine

The engine is exported too, for tests or non-React embeddings:

```ts
import { Simulator } from "sbx-simulator-web";

const sim = new Simulator({ spec, files: { "app/server.js": "…" } });
const out = sim.execute("sbx run"); // { lines, exit, matched, session? }
if (out.session) sim.prompt("add a health endpoint");
console.log(sim.state(), sim.files());
```

## Develop

```bash
npm install
npm run dev         # demo playground: edit a spec, drive the terminal, watch state
npm run build       # type-check + production build of the demo
npm run typecheck   # tsc --noEmit
```

The demo (`src/demo/`) is a playground with two sample labs adapted from the
CLI's `testdata/labs`; edit the YAML on the left and the terminal reloads.

## Layout

```
src/
  engine/     TypeScript port of the Go scenario engine
    types.ts        manifest/effect types + settings resolution
    manifest.ts     YAML -> Lab (normalizes command paths & arg matchers)
    commands.ts     command-line tokenize + parse (tokens/flags)
    state.ts        in-memory dot-path state store
    filesystem.ts   in-memory, path-confined virtual FS
    template.ts     {{ args.* }} / {{ state.* }} substitution
    match.ts        first-match-wins command & agent matching
    apply.ts        applies then: files -> state -> output -> mcp
    run.ts          run() / runAgent() with unmatched defaults
    mcp.ts          mocked MCP call rendering
    simulator.ts    high-level facade the component drives
  react/
    SbxTerminal.tsx the terminal component
    SbxTerminal.css terminal styling
    useSimulator.ts hook that memoizes a Simulator from the spec
  demo/         Vite demo playground
```

The engine mirrors the Go packages of the same name in
[`../sbx-simulator`](../sbx-simulator); see its
[`docs/scenario-spec.md`](../sbx-simulator/docs/scenario-spec.md) for the full
`sbx-simulator.yaml` schema.
