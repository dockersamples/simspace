# @dockersamples/simspace-simulator

A deterministic, in-browser terminal simulator: a config-driven state machine
plus a React mock-terminal component. No backend, no network, no AI API keys, no
real Docker — every command a learner types is matched against author-declared
scenarios and produces the same output, file changes, and state transitions every
time.

This package is the reusable core of the [Labspace](../../../README.md) platform.
It exists as its own package because the terminal is wanted in more places than
the lab app: documentation pages, the marketing site, and (soon) in-slide live
demos all want a scripted terminal without the instructions pane, progress
tracking, or catalog that a lab brings with it.

## Layers

```
@dockersamples/simspace-simulator          the engine — a pure state machine
@dockersamples/simspace-simulator/react    <SimTerminal> and <MockTerminal>
```

The engine entry has **one** dependency (`yaml`) and touches no DOM, no browser
API, no clock, and no randomness — so validators, build tooling, and tests can
import it without pulling in React. `test/engine/purity.test.ts` asserts this
rather than trusting it.

## Embedding a terminal

The common case — one terminal, one simulator, driven from a spec string:

```jsx
import { SimTerminal } from "@dockersamples/simspace-simulator/react";

const spec = `
version: "2.0"
scenarios:
  - id: ps
    when: { command: "docker ps" }
    then:
      output:
        - "CONTAINER ID   IMAGE     STATUS"
        - "a1b2c3d4e5f6   nginx     Up 2 minutes"
`;

<SimTerminal spec={spec} style={{ height: 320 }} />;
```

The component ships its own stylesheet, so it arrives styled with no extra step.
Where CSS side-effect imports aren't usable (SSR, a plain `<link>`, a strict CSP),
import the sheet directly instead:

```js
import "@dockersamples/simspace-simulator/react/styles.css";
```

It's fully self-contained — its own custom properties and a system monospace
stack, no CSS framework and no webfont — so it neither inherits from nor leaks
into the host page.

### Persistence is opt-in

By default the terminal **keeps nothing**: every mount starts from the greeting.
That's what an embedded demo wants — a reload should reset it, not resume a
stranger's half-finished session.

Pass `storageKey` to make a session resume across reloads. The caller owns the
whole key, so it can be namespaced however suits the host app:

```jsx
<MockTerminal storageKey={`simspace:terminal:${terminalId}:${labId}`} … />
```

### Several terminals, one machine

Reach past `SimTerminal` to `MockTerminal` when several terminals must share
**one** simulator — one state tree and one virtual filesystem, like two shells on
the same machine, so a command run in one is visible in the others. Build the
`Simulator` yourself and hand the same instance to each:

```jsx
const simulator = useMemo(() => new Simulator({ spec, files }), [spec]);

<MockTerminal simulator={simulator} terminalId="host" />
<MockTerminal simulator={simulator} terminalId="agent" />
```

That's what the lab app does (see `app/src/context/TerminalContext.jsx`), along
with the cross-terminal `subscribe`/`onChange` plumbing that keeps shared UI in
sync. `SimTerminal` deliberately can't express it, because
one-simulator-per-terminal is the right default everywhere else.

## Using the engine directly

```js
import { Simulator } from "@dockersamples/simspace-simulator";

const sim = new Simulator({ spec: yamlText, files: { "app/server.js": "…" } });
const outcome = sim.execute("docker run --name web nginx");
// → { lines: [{ text, stream, delayMs?, pause? }], exit, matched, completes? }

sim.getState("running"); // read the state tree
sim.files(); // snapshot the virtual filesystem
sim.reset(); // re-seed both from the manifest
```

The spec format is documented in [`spec/simulator.md`](../../../spec/simulator.md)
and is versioned: `checkSchemaVersion` accepts any `2.x` manifest, so a spec
declares the contract it was written against.

## Development

```bash
npm test                 # vitest, from this directory or the app root
npm run test:watch
npm run typecheck        # tsc --noEmit
```

The test toolchain (vitest, jsdom, testing-library) is currently installed at the
workspace root in `app/package.json` rather than here, so React resolves to a
single copy. That moves into this package if it's ever split into its own repo.

`typecheck` is load-bearing beyond types: `tsconfig.json` sets `rootDir: src`, so
any import that escapes this package fails the check. That's what keeps the
boundary real while the app consumes this package's TypeScript source directly
(no build step, so nothing else would catch a reach back into app code).

## Publishing

Not published yet. `exports` currently point at TypeScript **source**, which
works for any bundler-based consumer (and is what the lab app uses) but not for
plain `<script>` or non-bundler sites. Before publishing this needs a lib build
emitting ESM + `.d.ts`, and — depending on what the docs and www sites are built
with — likely a framework-agnostic custom-element wrapper so a React 19 peer
dependency isn't forced on a Hugo or Docusaurus page.
