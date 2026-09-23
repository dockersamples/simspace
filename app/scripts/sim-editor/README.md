# `sim-editor` — a GUI for a `simulator.yaml` state machine

```bash
cd app
npm run edit-sim                                        # every spec under public/labs
npm run edit-sim -- public/labs/tour-of-docker          # one lab
npm run edit-sim -- public/labs/tour-of-docker/simulator.yaml
npm run edit-sim -- --port 5180                         # default is 5174
```

Open the URL it prints. Three panes: the scenarios in match order, a form for
the selected one, and a console that runs commands against the spec you are
editing.

---

## What it's for

A `simulator.yaml` is an ordered list of rules, and the two things that decide
what a learner actually sees are invisible in the file:

- **Order is priority.** First match wins, so an earlier, more general scenario
  silently eats a later, more specific one.
- **State is the gate.** A scenario fires only when its `when.state` holds, and
  what sets that state is somewhere else in the file.

So the editor leads with those rather than with fields:

| In the UI                              | What it answers                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| The numbered, reorderable list         | Which scenario wins, and where this one sits                                        |
| **Active state** card (always visible) | What this needs (pre) and what it changes (post)                                    |
| **reached from** / **leads to**        | Which scenarios produce the state this one needs, and which ones its effects unlock |
| **also answers this command**          | Every other scenario matching the same command, in order                            |
| **unreachable**                        | This scenario can never fire, and which earlier one is eating it                    |
| **State** tab                          | Every dot-path, its seed, and everyone who reads, writes, toggles or requires it    |
| **Try it**                             | Run a command through the real engine against your _unsaved_ edits                  |
| **Checks**                             | Live authoring checks, plus a button that runs the real `validate-lab`              |

The output editor puts the `delay` beside the line it paces, has a one-click
pure pause (a delay that prints nothing), and turns a multi-line paste into one
row per line — which is what you want every time you copy real CLI output.

## What it won't do to your file

Saving is **surgical**. The editor diffs the model you edited against the
parsed file and rewrites only the bytes that changed, so comments, blank lines,
quote styles and flow/block choices survive untouched, and `git diff` shows the
edit rather than a reformat.

That mattered enough to build: a plain `parseDocument(text).toString()`
round-trip — with no edits at all — rewrites **121 of the 602 lines** of
`tour-of-docker/simulator.yaml`. Lab YAML is hand-formatted, and Prettier is
deliberately kept away from `public/labs/**` (it would rewrite `***` into `---`
and split a slide in two), so nothing puts that formatting back.

Four guarantees, in the order they apply:

1. **You see the diff first.** Every save opens a review with the exact unified
   diff. Nothing is written until you accept it.
2. **The result is verified.** The patched text is re-parsed and deep-compared
   to the model you edited. A mismatch is never written; the editor falls back
   to a whole-document rewrite (which keeps comments but reformats) and _tells
   you_ in the review that it did.
3. **The file can't be clobbered.** If something else changed it since you
   opened it — an agent, another editor — the save is refused with a 409 and
   you're offered the new contents.
4. **There's an undo outside the editor.** Every save copies the previous
   contents into `$TMPDIR/simspace-sim-editor/` first, and the write itself is
   a temp file plus a rename.

Reordering is text-exact: a moved scenario is cut and re-inserted with its
original bytes, so a pure reorder adds and removes nothing at all.

Fields the form doesn't model are never touched, because the form mutates the
parsed file in place rather than rebuilding it from what it knows about. Every
scenario also has a **This scenario as YAML** panel as an escape hatch.

## How it fits the repo

`app/` is the product: a static site with no backend. An editor has to write
files, so this is Node tooling under `app/scripts/`, beside `validate-lab.ts`
and `generate-catalog.mjs` — no authoring UI in the shipped bundle, nothing
added to `app/src/`.

It runs through `scripts/run-ts.mjs`, so it resolves the workspace packages to
their **source** via the shared alias map, and it imports the **real engine**
(`@dockersamples/simspace-simulator`). Every answer it gives about matching,
output, pacing and state comes from the same code the learner's terminal runs,
so the editor and the lab cannot disagree.

```
server.ts     HTTP + JSON API; owns the open file and a live Simulator
patch.ts      the surgical writer                       (49 tests)
analyze.ts    order, state map, overlaps, transitions   (19 tests)
lint.ts       live authoring checks                     (24 tests)
discover.ts   finds specs + the labspace context each one needs
public/       the browser UI — plain ES modules, no build step
  model.js      the form <-> YAML mapping               (20 tests)
  dom.js        a small element builder
  list.js       the three left-hand lists
  editor.js     the scenario and lab forms
  side.js       console, checks, YAML
  app.js        model, selection, undo, save review
  ui.test.js    a jsdom smoke test that drives the real UI (25 tests)
```

The suite runs as part of `npm test` (`vitest.config.js` includes
`scripts/**/*.test.{js,ts}`). The patcher's tests include a sweep that applies
nine kinds of edit to **every scenario in both sample labs** and asserts each
one stays on the surgical path and still means what the editor intended.

### The live checks are a subset, on purpose

`npm run validate-lab` stays the authoritative, CI-gating check: it validates
every lab, the markdown, the labspace cross-references, and regenerates
`labs.json`. `lint.ts` is the part that can run on every keystroke against the
in-memory model, so a broken reference shows up while you're looking at the
field that broke it. Where the two overlap, the wording is identical. The
**Run validate-lab** button in the Checks tab runs the real thing.

The editor does report one thing `validate-lab` doesn't: **unreachable
scenarios** (`spec/simulator.md` §16 lists a state-threaded playthrough lint as
deferred). It only claims it when it can prove it — when an earlier scenario's
conditions are a strict subset of a later one's, so the earlier one always wins.

## Notes

- **Ports.** The default is 5174, next to the preview's 5173. The authoring kit
  (`kit/spec.yaml`) publishes 5173 and 8888 only, so inside a Docker Sandbox
  this port isn't forwarded yet — run it on the host, or add a port to the kit.
- **Shared specs.** A deck reusing its lab's `simulator.yaml` is detected: the
  file is marked shared and terminal/step-id checks are skipped for it, because
  those ids belong to whichever entry is running.
- **`labs.json`.** The Run validate-lab button regenerates it, as the validator
  always does. It's generated and git-ignored; don't hand-edit it.
- **The `+=` append form.** `spec/simulator.md` §7.2 writes it as
  `docker.events += "started"`, which is not valid YAML — with no colon the
  whole block parses as one string and the engine iterates its characters. The
  form the engine implements is a key _ending_ in `+=`:
  `docker.events +=: "started"`. The editor writes that form and flags the
  broken one.
