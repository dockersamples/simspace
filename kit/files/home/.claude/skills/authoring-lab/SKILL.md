---
name: authoring-lab
description: Author or edit a Simspace lab — add or change instruction sections (markdown), command behaviour (scenarios in simulator.yaml), terminals, controls, seed files, or CI. Use whenever creating lab content, wiring up a new command or agent prompt, or before committing lab changes. For presentation slides (an entry with `kind: slides`), use authoring-slidedeck instead.
---

# Authoring a Simspace lab

You are editing a **Simspace lab**: instructional markdown plus a deterministic,
in-browser terminal simulator. Each lab lives in its own directory under `labs/`
(`labs/<id>/`); you only edit files there. The `labs.json` catalog is generated —
never edit it.

This skill is the working reference. The normative formats live in
[`dockersamples/simspace`](https://github.com/dockersamples/simspace) under
`spec/simulator.md`, `spec/labspace.md`, and `spec/catalog.md` — read those when
this skill is silent on something, or when you need to be sure.

**Building presentation slides instead?** Use the **authoring-slidedeck** skill.
A deck is an entry with `kind: slides` — same `labspace.yaml` format, but slides,
layouts, and a theme rather than sections. Everything in *this* skill about
`simulator.yaml` still applies to a deck's live demos, and a deck usually reuses
its sibling lab's spec rather than defining its own.

## The loop (do this every time)

1. Edit files under `labs/<id>/`.
2. Give every hands-on section **milestones** (`steps:` + `completes:`) — see
   [Milestones](#milestones-every-lab-needs-them). This is the step most often
   skipped, and skipping it silently breaks the lab's analytics.
3. Validate: `docker compose run --rm validate` — checks every lab and regenerates
   labs.json (a PostToolUse hook also runs it after edits — fix anything it reports).
4. Preview if useful: `docker compose up dev` → http://localhost:5173 (changes
   show on browser refresh).
5. **Definition of done:** validation is green, every hands-on section has at
   least one milestone, _and_, for anything non-trivial, you've eyeballed it in
   the preview.

## Mental model

The simulator is a state machine. Each command the learner types is matched
against `scenarios` in `simulator.yaml` **top-to-bottom, first match wins**; the
matched scenario's `then` produces output, file changes, and state deltas. Same
state + same command ⇒ same result, always. No time, randomness, or network.

## Add a section

1. Create `labs/<id>/NN-title.md` (numeric prefix keeps ordering obvious).
2. Register it in that lab's `labspace.yaml` under `sections:`:
   ```yaml
   sections:
     - title: My New Section
       contentPath: NN-title.md
   ```
3. Any command you tell the learner to run needs a scenario (below) or it will
   fail validation as unreachable.
4. If the section asks the learner to *do* something, give it `steps:` and tag
   the proving scenario with `completes:` — see [Milestones](#milestones-every-lab-needs-them).

Runnable code fence → gets a **Run** button:

````markdown
```bash
docker ps
```
````

Prompt fence → renders plaintext, but still gets a **Run** button that sends
the text into the terminal (e.g. an AI agent session). Use for prompts to type,
not shell commands:

````markdown
```prompt terminal-id=agent
Refactor the server to read the port from an environment variable.
```
````

Save-a-file fence → gets a **Save** button (writes to the virtual FS):

````markdown
```yaml save-as=config.yaml
key: value
```
````

Target a specific terminal with `terminal-id=<id>`; link a file with
`:filelink[label]{path="config.yaml"}`.

## Add a command scenario

Append to `scenarios:` in that lab's `simulator.yaml`. Put **specific** cases
before general ones.

```yaml
- id: unique-id # shows up in errors/traces
  when:
    command: [docker, run] # leading command tokens
    args: { --name: { any: true } } # capture a flag/positional
    state: { container.running: false } # precondition (equality)
  then:
    state: { container.running: true } # delta (dot-path; `key +=` appends to a list)
    output: ["started {{ args.name }}"] # {{ args.name }} / {{ state.x }} templating
```

Common shapes (see `spec/simulator.md` for full detail):

- **Gate a command on state**, then flip it with a second scenario (e.g. a
  `docker stop` that only matches when `running: true`).
- **Agent session:** a scenario with `then.session` opens a REPL; lines typed
  there match `when.agent: true` scenarios via `prompt` / `promptContains`.
- **Controls:** top-level `controls:` add Settings toggles that flip a state
  value with no command — good for gating a scenario behind a policy.
- **CI:** `then.ci` triggers a run from the `workflows:` catalog (needs the CI
  tab enabled in `labspace.yaml`). To let a run's outcome follow a setting,
  gate a step with `requires: <state.path>` (+ a `failure:` block) and omit
  `conclusion` — the CI panel's **Re-run** button then re-evaluates it, so a
  learner fixes a failed run by toggling a control and re-running, not by
  pushing again.
- **Pace slow-feeling output:** to keep a pull/build/scan from printing
  instantly, make an `output` entry an object with a `delay:` — the wait before
  that line appears. `delay` is a raw ms count or a pace-profile name (built-ins
  `short`/`medium`/`long`, or define your own under `settings.pace`). An entry
  with a `delay:` but no `text:` is a pure pause. It's cosmetic only — the output
  is unchanged, so the lab stays deterministic.

  ```yaml
  settings:
    pace: { scan: 1400 } # add/retune profiles; short/medium/long are built in
  scenarios:
    - id: scout
      when: { command: [docker, scout, cves] }
      then:
        output:
          - "    ✓ Indexed 142 packages"
          - { delay: scan } # hold a beat while it "analyses"
          - "1 vulnerability found in 1 package"
  ```

## Milestones (every lab needs them)

A **step** is an author-declared checkpoint: "the learner actually ran this."
Steps are what drive the nav check-marks, the learner's saved progress, and the
whole Pulse instructor funnel. They're opt-in in the format but **not optional in
practice** — a lab with no steps reports nothing but "N people started," and
`lab_completed` never fires at all, because the app emits it only once *every*
cataloged step is done. Validation stays green either way, so nothing will remind
you: adding steps is on you.

Budget roughly **one step per thing you ask the learner to do** — 3–8 across a
typical lab. They're a funnel, so a step should mark real forward progress, not
every command typed.

Two halves that must line up:

1. **Catalog the checkpoints** on the section in `labspace.yaml`:

   ```yaml
   sections:
     - title: Running containers
       contentPath: 01-run.md
       steps:
         - id: run-container # referenced by `completes:`; defaults to slugify(title)
           title: "Run a container" # label in the progress UI and funnel
         - id: stop-container
           title: "Stop the container"
   ```

2. **Tag the scenario that proves it** in `simulator.yaml`. `completes` is a
   sibling of `when`/`then`, not inside `then`:

   ```yaml
   - id: docker-run
     completes: run-container # fires when this scenario matches
     when:
       command: [docker, run]
       state: { container.running: false }
     then:
       state: { container.running: true }
       output: ["…"]
   ```

Notes:

- Because firing is already gated on the right command **and** the right state,
  a step is a strong signal — not "they read the page."
- The funnel renders steps in **catalog order** (section order, then step order),
  between a "Started the lab" anchor and a "Completed the lab" goal — so declare
  them in the order learners actually reach them, or the drop-off chart lies.
- Several scenarios may complete the **same** step (e.g. `greet` with or without
  a `--name` flag). Do that instead of forcing one path.
- Works the same for agent scenarios (`when.agent: true`).
- For an interactive-input scenario, `completes` fires on **submission**; an
  abort (`/cancel`) completes nothing.
- Reading-only sections legitimately have no `steps:` — omit the key entirely.
- Validation **errors** on a `completes:` naming an unknown step id, and **warns**
  on a cataloged step no scenario completes. Both mean the two halves drifted.
- Renaming or removing step ids invalidates learners' stored progress for that
  lab version — settle on ids while authoring, then keep them stable.

## `labspace.yaml` reference

One per entry, at `labs/<id>/labspace.yaml`. It is the whole configuration
surface — everything else in the directory is markdown or the simulator spec.

```yaml
kind: lab # OPTIONAL: `lab` (default) or `slides` — see the authoring-slidedeck skill
title: "…" # in-lab header
simulator: simulator.yaml # path to this entry's spec; may point at a sibling's
catalog: # OPTIONAL landing-page card (only shown with 2+ entries)
  icon: school #   a Material Symbols name; also: title/description overrides,
  tags: ["intro"] #   tags, estimatedMinutes, order. labs.json is generated from this.
terminals: [{ id: host, title: Terminal, icon: terminal }] # several share one machine
files: { "path": "seed contents" } # virtual filesystem seed
tracking: true # OPTIONAL: false opts this entry out of presence + analytics
sections: # ordered pages; `steps:` are this section's milestones (above)
  - { title: "Intro", contentPath: 00-intro.md }
  - title: "Run it"
    contentPath: 01-run.md
    steps: [{ id: run-container, title: "Run a container" }]
variables: { name: world } # $$name$$ substitution in the section markdown
```

Code fences in section markdown take meta after the language:

- ` ```bash terminal-id=host ` — the Run button targets terminal `host`. **On a
  slide this is what creates the Run button at all** — deck fences are samples by
  default, so `no-run-button` is only ever needed in a lab.
- ` ```prompt terminal-id=agent ` — renders plaintext; the Run button sends the
  text into the terminal (e.g. an AI agent session). For prompts to type, not
  shell commands.
- ` ```yaml save-as=path/to/file ` — a Save button that writes the block to the
  virtual filesystem.
- `no-run-button`, `no-copy-button`, and `highlight=1-2` also work.

Directives: `:filelink[label]{path="app/x.js"}` cats a file;
`:variableDefinition[name]{prompt="…"}` prompts the learner for a `$$name$$`
value.

The authoritative version of all of this is `spec/labspace.md` in
[`dockersamples/simspace`](https://github.com/dockersamples/simspace).

## Make the output look real

Invented output is what makes a lab feel fake: a column header the CLI doesn't
print, a flag that doesn't exist, an empty-state message nobody would recognise.
Before writing `then.output` for a real tool, check
**[`dockersamples/sample-cli-output`](https://github.com/dockersamples/sample-cli-output)** —
one markdown file per subcommand, each with the live `--help` text and real
example output, organised by tool and version.

```bash
# what tools/versions are covered
curl -s https://raw.githubusercontent.com/dockersamples/sample-cli-output/main/README.md
# command → file map for one version
curl -s https://raw.githubusercontent.com/dockersamples/sample-cli-output/main/sbx/v0.38.0/INDEX.md
# the sample output for one subcommand
curl -s https://raw.githubusercontent.com/dockersamples/sample-cli-output/main/sbx/v0.38.0/sbx-list.md
```

(`gh api repos/dockersamples/sample-cli-output/contents/<path>` or a WebFetch of
the same raw URL work equally well — it's a public repo.)

Use it to:

- copy column headers, spacing, status strings, and id formats **verbatim**;
- confirm the flags you tell learners to type actually exist in that version —
  the `--help` capture is the source of truth, not your recollection;
- lift the real empty-state and error text for scenarios that model a mistake;
- read from the **version directory matching the tool version the lab teaches**.

If a command has no file there, keep the invented output minimal and plausible
rather than embellishing — and say so when you hand the lab over, since the gap
is worth filling in that repo (run its `scripts/generate-<tool>.sh` if you have
the CLI installed).

## Gotchas that cause validation errors

- **Template capture names drop dashes:** a `--name` matcher is read as
  `{{ args.name }}`, positional `0:` as `{{ args.0 }}`. Only `equals`/`any`/`oneOf`
  matchers capture a value.
- **First match wins** — a broad scenario above a specific one shadows it.
- **`save-as` blocks are files, not commands** — don't expect them to match a
  scenario. Plain runnable blocks must have a matching scenario or built-in
  (`ls`/`cat`).
- **`terminal-id=` and `when.terminal`** must reference a terminal `id` declared
  in `labspace.yaml`.

When in doubt, run the validator — it names the file, scenario, and problem.

## Add another lab

Create a sibling directory `labs/<new-id>/` with its own `labspace.yaml`,
`simulator.yaml`, and section markdown, then run `validate`. The catalog picks it
up automatically — with two or more entries the app shows a landing page; nothing
else to wire up. Give each card a look with the optional `catalog:` block in its
`labspace.yaml` (see the reference above).

## Pairing a lab with slides

Workshops usually want both. Add a deck as a sibling entry
(`labs/<lab-id>-slides/` with `kind: slides`), pointing its `simulator:` at
**this** lab's spec so the demos on the slides run the exact commands the learners
will run — the two then can't drift apart. Set `catalog.order` so the deck sorts
first. See the **authoring-slidedeck** skill.
