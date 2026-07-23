---
name: authoring-lab
description: Author or edit this Labspace lab — add or change instruction sections (markdown), command behaviour (scenarios in simulator.yaml), terminals, controls, seed files, or CI. Use whenever creating lab content, wiring up a new command or agent prompt, or before committing lab changes.
---

# Authoring a Labspace lab

You are editing a **Labspace lab**: instructional markdown plus a deterministic,
in-browser terminal simulator. You only edit files under `lab/`. Read
[`AGENTS.md`](../../../AGENTS.md) for the full cheat-sheet and the link to the
authoritative specs.

## The loop (do this every time)

1. Edit files under `lab/`.
2. Validate: `docker compose run --rm validate` (a PostToolUse hook also runs this
   automatically after lab edits — fix anything it reports).
3. Preview if useful: `docker compose up dev` → http://localhost:5173 (changes
   show on browser refresh).
4. **Definition of done:** validation is green _and_, for anything non-trivial,
   you've eyeballed it in the preview.

## Mental model

The simulator is a state machine. Each command the learner types is matched
against `scenarios` in `simulator.yaml` **top-to-bottom, first match wins**; the
matched scenario's `then` produces output, file changes, and state deltas. Same
state + same command ⇒ same result, always. No time, randomness, or network.

## Add a section

1. Create `lab/NN-title.md` (numeric prefix keeps ordering obvious).
2. Register it in `lab/labspace.yaml` under `sections:`:
   ```yaml
   sections:
     - title: My New Section
       contentPath: NN-title.md
   ```
3. Any command you tell the learner to run needs a scenario (below) or it will
   fail validation as unreachable.

Runnable code fence → gets a **Run** button:

````markdown
```bash
docker ps
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

Append to `scenarios:` in `lab/simulator.yaml`. Put **specific** cases before
general ones.

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

Common shapes (see `AGENTS.md` / specs for full detail):

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
