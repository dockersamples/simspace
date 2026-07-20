# Terminal Simulator — Web

An in-browser React terminal that runs labs directly from a `simulator.yaml`
spec — no binary, no server, no network. Authors define scenarios for any
command (`docker run`, `git push`, `kubectl apply`, …) and learners type them
in a browser terminal that responds with scripted, deterministic output.

## What it simulates (and what it doesn't)

- ✅ **Any command** — the full scenario engine: command/arg/state matching,
  `then` effects (files, state deltas, output, MCP), and templating. Commands
  are not restricted to any particular program or prefix.
- ✅ **Agent sessions** — interactive agent REPLs (`then.session`), the
  scripted-agent banner, keyword/exact prompt matching, and one-shot
  `-p "…"` mode.
- ✅ **`ls` and `cat`** — built-in commands that reflect the virtual
  filesystem automatically. A `!ls app` or `!cat app/server.js` inside a
  session works without any scenario, as long as a `then.files` effect has
  created those paths. Define a `command: ls` scenario to override the
  built-in output.
- ✅ **`!cmd` in sessions** — inside a session REPL, a line starting with `!`
  runs the rest through the normal command engine (same matching as top-level
  commands, including built-ins). The `!` distinguishes "run a command" from
  "talk to the agent".
- ✅ **`clear`** — a terminal built-in that wipes the screen without touching
  lab state, available in both command and session mode.
- 🚫 **Real processes** — no actual shell is executed. An unmatched command
  with no built-in produces a `command not found` message (customizable via
  `defaults.unmatched`).

Everything runs against an **in-memory** state store and virtual filesystem,
so `then.files` effects behave consistently and `ls`/`cat` reflect them
immediately.

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

| Prop            | Type                     | Default              | Purpose                                                        |
| --------------- | ------------------------ | -------------------- | -------------------------------------------------------------- |
| `spec`          | `string`                 | —                    | The `simulator.yaml` document text. **Required.**              |
| `files`         | `Record<string, string>` | `{}`                 | Seed the virtual filesystem, keyed by lab-relative path.       |
| `shellPrompt`   | `string`                 | `"$ "`               | Prompt shown in command mode.                                  |
| `streaming`     | `boolean`                | lab `settings`       | Override line-by-line streamed output.                         |
| `streamDelayMs` | `number`                 | lab `settings` (20)  | Per-line delay while streaming.                                |
| `agentThinkMs`  | `number`                 | lab `settings` (700) | "Evaluating…" spinner duration before agent replies (0 = off). |
| `showHeader`    | `boolean`                | `true`               | Show the title bar + Reset button.                             |
| `greeting`      | `string[]`               | derived              | Lines printed once on start (pass `[]` to suppress).           |
| `onStateChange` | `(state) => void`        | —                    | Called with a fresh state snapshot after every command/turn.   |
| `className`     | `string`                 | —                    | Extra class on the root element.                               |
| `style`         | `React.CSSProperties`    | —                    | Inline style on the root (e.g. to set a height).               |

Changing `spec` (or `files`) rebuilds the simulator and resets the terminal.
The **Reset** button re-seeds state and files from the manifest.

### Headless engine

The engine is exported for tests or non-React embeddings:

```ts
import { Simulator } from "sbx-simulator-web";

const sim = new Simulator({ spec, files: { "app/server.js": "…" } });

// Run a command
const out = sim.execute("docker run --name web -d nginx");
console.log(out.lines, out.exit, out.matched);

// Enter an agent session (if the matched scenario set then.session)
if (out.session) {
  sim.prompt("add a health endpoint");
}

// Built-ins reflect the virtual FS
sim.execute("docker run --name web -d nginx"); // triggers then.files
sim.execute("ls app");                          // lists virtual app/ directory
sim.execute("cat app/server.js");               // prints virtual file content

console.log(sim.state(), sim.files());
```

## Develop

```bash
npm install
npm run dev         # demo playground: edit a spec, drive the terminal, watch state
npm run build       # type-check + production build of the demo
npm run typecheck   # tsc --noEmit
```

The demo (`src/demo/`) is a playground; edit the YAML on the left and the
terminal reloads.

## Layout

```
src/
  engine/     TypeScript scenario engine
    types.ts        manifest/effect types, Result, settings resolution
    manifest.ts     YAML -> Lab (normalizes command paths & arg matchers)
    commands.ts     command-line tokenize + parse (tokens/flags)
    state.ts        in-memory dot-path state store
    filesystem.ts   in-memory, path-confined virtual FS
    template.ts     {{ args.* }} / {{ state.* }} substitution
    match.ts        first-match-wins command & agent matching
    apply.ts        applies then: files -> state -> output -> mcp
    builtins.ts     built-in ls/cat commands over the virtual FS
    run.ts          run() / runAgent() with built-in + unmatched defaults
    mcp.ts          mocked MCP call rendering
    simulator.ts    high-level facade the component drives
  react/
    SbxTerminal.tsx the terminal component
    SbxTerminal.css terminal styling
    useSimulator.ts hook that memoizes a Simulator from the spec
  demo/         Vite demo playground
```

See [`../sbx-simulator/docs/scenario-spec.md`](../sbx-simulator/docs/scenario-spec.md)
for the full `simulator.yaml` schema reference.
