# AGENTS.md

Guide for agents authoring this Labspace lab. Read this first.

## What this repo is

A **single lab**. You only edit files under `lab/`. The app that runs the lab is
a prebuilt image (`dockersamples/labspace-web`); you never touch app source. The lab
is plain data — Markdown + two YAML files — loaded at runtime, so there is no
build step for content.

```
lab/
  labspace.yaml     # lab config: title, terminals, seed files, sections, variables
  simulator.yaml    # command behaviour: scenarios (when → then), state, controls
  *.md              # one markdown file per section
compose.yaml        # `up dev` to preview, `run --rm validate` to lint
Dockerfile          # optional: build a container that serves this lab
CLAUDE.md           # loads this guide automatically in Claude Code
.claude/            # skill (authoring-lab), pre-allowed perms, auto-validate hook
.github/workflows/  # validate.yml (PRs) + deploy.yml (Pages on push to main)
```

## The loop

```bash
docker compose up dev                 # live preview at http://localhost:5173
docker compose run --rm validate      # lint the lab — ALWAYS run before committing
```

`validate` exits non-zero on errors (dangling references, unmatched commands,
`{{ args.X }}` with no capture, …). Treat a red validate as a broken lab. Edits
to `lab/` show in the preview on **browser refresh**.

In Claude Code, a **PostToolUse hook** (`.claude/`) runs `validate` automatically
after you edit anything under `lab/` and feeds any errors back to you — so fix
them before finishing. The `docker compose` and `validate-lab` commands are
pre-allowed, so they won't prompt.

**Definition of done:** validation is green, and for anything non-trivial you've
eyeballed it in `docker compose up dev`. Then commit and push to `main` → CI
validates and GitHub Pages deploys automatically. Pull requests are validated by
`.github/workflows/validate.yml` before merge.

## simulator.yaml cheat-sheet

The simulator is a deterministic state machine. Each command the learner types is
matched against `scenarios` **top-to-bottom, first match wins**; the matched
scenario's `then` produces output, file changes, and state deltas.

```yaml
version: "2.0"
state: { container: { running: false } } # initial state tree
scenarios:
  - id: run # unique id
    when:
      command: [docker, run] # leading command tokens
      args: { --name: { any: true } } # flag/positional matchers (capture with any/oneOf)
      state: { container.running: false } # state preconditions (equality)
      terminal: host # optional: only this terminal id
    then:
      state: { container.running: true } # state deltas (dot-paths; `key +=` appends)
      output: ["started {{ args.name }}"] # stdout; {{ args.name }} / {{ state.x }} templating
      files:
        - create: app/x.js
          content: "…" # also: append/replace(find/with)/delete/copy(to)/mkdir
```

Key rules:

- **Template capture names drop dashes:** a `--name` matcher is read as
  `{{ args.name }}`; positional `0:` as `{{ args.0 }}`. Only `equals`/`any`/`oneOf`
  matchers capture.
- **`ls` and `cat` are built in** — they reflect the virtual filesystem with no
  scenario needed. A scenario always wins over a built-in.
- **Agent sessions:** a scenario with `then.session` opens an interactive REPL;
  lines typed there match `when.agent: true` scenarios (`prompt` / `promptContains`).
- **Controls** (top-level `controls:`) add Settings toggles that flip a state
  value without a command — good for gating a scenario behind a policy.
- **Pace slow-feeling output** so a pull/build/scan doesn't print instantly. An
  `output` entry can be an object with a `delay:` (a raw ms count, or a pace
  profile name — built-ins `short`/`medium`/`long`, or your own under
  `settings.pace`). A `{ delay: long }` with no `text` is a pure pause. Pacing is
  cosmetic only — it never changes what's printed.

  ```yaml
  output:
    - "Unable to find image 'nginx:latest' locally"
    - { text: "latest: Pulling from library/nginx", delay: short }
    - { text: "a480a496...: Pull complete", delay: long }
    - "Status: Downloaded newer image for nginx:latest"
  ```

- Put specific scenarios **before** general ones; the first match wins.

## labspace.yaml cheat-sheet

```yaml
title: "…"
simulator: simulator.yaml
terminals: [{ id: host, title: Terminal, icon: terminal }] # multiple share one machine
files: { "path": "seed contents" } # virtual filesystem seed
sections: [{ title: "Intro", contentPath: 00-intro.md }] # ordered pages
variables: { name: world } # $$name$$ substitution in markdown
```

Markdown code fences take meta after the language:

- ` ```bash terminal-id=host ` — Run button targets terminal `host`.
- ` ```yaml save-as=path/to/file ` — Save button writes the block to the FS.
- `no-run-button`, `no-copy-button`, `highlight=1-2` also supported.

Directives: `:filelink[label]{path="app/x.js"}` (cats a file),
`:variableDefinition[name]{prompt="…"}` (prompts for a `$$name$$` value).

## Full specifications

The cheat-sheets above are summaries. The authoritative specs live in the
platform repo: `dockersamples/sbxlab` → `spec/simulator.md` and
`spec/labspace.md`.
