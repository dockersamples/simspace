# Build your own

You've now seen the whole toolkit. Here's the recap — and where each piece is
defined.

| Feature | Directive / field | Lives in |
| --- | --- | --- |
| Variable prompt | `:variableDefinition` + `$$name$$` | section markdown |
| Set-a-value button | `:variableSetButton` | section markdown |
| Conditional content | `:conditionalDisplay` (variable or `os`) | section markdown |
| File link | `:fileLink` | section markdown |
| Tab link | `:tabLink` | section markdown |
| Run / Save buttons | code fence + `save-as=` | section markdown |
| Scripted commands | `scenarios:` | `simulator.yaml` |
| Shared state | `state:` + `when.state` / `then.state` | `simulator.yaml` |
| Output pacing | `settings.pace` + `delay:` | `simulator.yaml` |
| Multiple terminals | `terminals:` + `when.terminal` | `labspace.yaml` / `simulator.yaml` |
| Settings toggles | `controls:` | `simulator.yaml` |
| Agent sessions | `then.session` + `agent:` scenarios | `simulator.yaml` |
| CI pipelines | `features.ci` + `workflows:` + `then.ci` | both files |
| External tabs | `services:` | `labspace.yaml` |

## External service tabs

Speaking of `services:` — this lab declares one. Click below to open it in a tab
(it loads a real page, so it only works if your network allows it):

:tabLink[Open the Example tab]{id="example" href="https://example.com" title="Example" icon="public"}

## The whole lab is three kinds of file

Everything you just used is defined by:

- one **`labspace.yaml`** — title, terminals, seed files, variables, services, features;
- one **`simulator.yaml`** — the state tree and every command scenario;
- a handful of **markdown** files — one per section.

Drop those in a folder, add an entry to `labs.json`, and it shows up on the
landing page next to this one. That's it — no backend, no build step for content.

## Where to go next

- Try the **A Tour of Docker** lab from the landing page for an applied example.
- Read the specs in the project's `spec/` directory: `labspace.md`,
  `simulator.md`, and `catalog.md`.

Thanks for taking the tour!
