# Labspace — `labspace.yaml` Specification

**Status:** Draft

This document specifies the `labspace.yaml` file that authors write to define a
**Labspace**: a self-contained, in-browser lab consisting of instructional
content, one or more mock terminals, a virtual filesystem, and the simulator
that scripts every command. It is the top-level entry point the app loads.

Where `simulator.yaml` (see the companion `simulator.md` specification) defines
*command behaviour*, `labspace.yaml` defines *everything around it*: what the
learner reads, how many terminals they see, what files the lab ships with, and
which simulator spec drives those terminals.

The lab is **fully static and server-free**: the browser fetches
`labspace.yaml` and everything it references (the simulator spec, section
markdown, and any seed content) as static assets, and runs the whole lab
locally. No backend is required.

---

## 1. Core model

```
                ┌──────────────────────────────────────────────┐
  page load  ─► │ 1. read labs.json; pick the lab (id, or sole)  │
                │ 2. fetch + parse labspace.yaml                 │
                │ 3. fetch the referenced simulator: spec        │
                │ 4. fetch each section's contentPath markdown   │
                │ 5. seed the virtual filesystem from files:     │
                │ 6. render: instructions pane + terminal tabs   │
                └──────────────────────────────────────────────┘
```

Key properties:

- **Single source.** One `labspace.yaml` fully describes a lab. Paths it
  references are resolved **relative to the `labspace.yaml` file itself**.
- **Self-contained directory.** A lab lives in its own directory under `labs/`
  (`labs/<id>/`, holding `labspace.yaml` and everything it references) so it can
  be added, mounted, or swapped as a single unit without touching the app's own
  assets or other labs.
- **One simulator, many terminals.** Every declared terminal tab is backed by
  the **same** simulator instance — one shared state tree and one shared
  virtual filesystem. A change made in one terminal is visible in the others,
  like two shells on the same machine.
- **Content is markdown.** Sections are plain markdown files, rendered with a
  small set of lab-specific directives and `$$variable$$` substitution applied
  at render time.

---

## 2. Resolving which lab to load

Every lab lives in `labs/<id>/`, and the app reads a generated `labs.json`
catalog to find them (see the companion `catalog.md` specification). With one
lab the app enters it directly; with several it shows a landing page and runs the
chosen lab under `#/labs/<id>/…`:

```
https://example.com/                    → one lab: entered directly
                                          many:    the lab-selection page
https://example.com/#/labs/networking   → loads ./labs/networking/labspace.yaml
```

Paths **inside** each `labspace.yaml` (`simulator`, `sections[].contentPath`) are
resolved relative to that file's location — so within `labs/<id>/` they stay
simple (`simulator.yaml`, `00-intro.md`). The catalog itself is resolved relative
to the app's base URI, so subpath deploys (e.g. GitHub Pages) work unchanged.

---

## 3. Top-level `labspace.yaml` shape

```yaml
title: "Getting Started (Simulated)"        # OPTIONAL. Document / header title.
description: "A fully in-browser lab."       # OPTIONAL. Sub-title / summary.

simulator: simulator.yaml                    # REQUIRED. Path to the scenario spec.

terminals:                                   # OPTIONAL. Terminal tabs. §7
  - id: host
    title: Host
    icon: dns

files:                                       # OPTIONAL. Seed virtual FS. §8
  app/server.js: |
    console.log("hello");

sections:                                    # OPTIONAL. Instruction pages. §5
  - title: Introduction
    contentPath: 00-intro.md

variables:                                   # OPTIONAL. Substitution values. §6
  containerName: web

services:                                    # OPTIONAL. External-URL tabs. §9
  - title: Docs
    url: https://docs.example.com

features:                                    # OPTIONAL. Feature flags (e.g. CI tab). §10
  ci:
    title: CI
    icon: rocket_launch
```

Field summary:

| Field         | Required | Purpose                                                        |
| ------------- | -------- | -------------------------------------------------------------- |
| `title`       | no       | Header title; also sets `document.title` (default `"Labspace"`) |
| `description` | no       | Shown as the sub-title (default empty)                         |
| `simulator`   | **yes**  | Path (relative to this file) to the `simulator.yaml` spec      |
| `terminals`   | no       | Terminal tabs, all sharing one simulator (default: one tab)    |
| `files`       | no       | Seed files for the shared virtual filesystem                   |
| `sections`    | no       | Ordered instruction pages rendered in the left-hand panel      |
| `variables`   | no       | Initial values for `$$variable$$` substitution in content      |
| `services`    | no       | External-URL tabs (iframes) in the right-hand pane             |
| `features`    | no       | Feature flags that add built-in tabs (e.g. `ci`) (§10)        |

A `labspace.yaml` that does not parse to a mapping, or that omits `simulator`,
is a hard load error surfaced to the learner.

---

## 4. `title` / `description`

- `title` — shown in the workshop header and used as the base of the browser
  tab title (`"<title> - <active section title>"`). Defaults to `"Labspace"`.
- `description` — a one-line summary shown as the header sub-title. Defaults to
  an empty string.

---

## 5. `sections` — instruction pages

An ordered list of instruction pages shown in the left-hand panel. Each section
is one markdown file.

```yaml
sections:
  - title: Introduction
    contentPath: 00-intro.md
  - title: Run a container
    contentPath: 01-run.md
```

| Field         | Required | Purpose                                                 |
| ------------- | -------- | ------------------------------------------------------- |
| `title`       | yes      | Page title, shown in the nav and as the section heading |
| `contentPath` | no       | Path (relative to `labspace.yaml`) to the markdown file |

Behaviour:

- Each section gets an **id** derived from its `title` via slugification
  (lowercased; everything except letters, digits, whitespace and dashes
  stripped; whitespace runs collapsed to single dashes). The id is used in the
  route (`/<section-id>`), so keep titles unique.
- Sections render in the order declared; the first section is the default when
  none is selected.
- A section with no `contentPath` renders as empty content.
- Section markdown is fetched raw and stored as-is; `$$variable$$` substitution
  (§6) happens at **render time**, so content reflects the current variable
  values.

### 5.1 Section markdown authoring surface

Section content is GitHub-flavoured markdown with a few lab-specific extras.

**Fenced code blocks** support an info-string meta after the language:

````markdown
```bash terminal-id=host highlight=1-2 no-copy-button
docker run --name $$containerName$$ -d nginx
```
````

| Meta token         | Effect                                                           |
| ------------------ | ---------------------------------------------------------------- |
| `terminal-id=<id>` | Run/Save buttons target the terminal with this id (§7); falls back to the primary terminal when omitted |
| `save-as=<path>`   | Shows a **Save** button that writes the block's contents to `<path>` in the virtual filesystem |
| `highlight=<lines>`| Highlights the given line range (e.g. `highlight=1-2`)           |
| `no-run-button`    | Hides the **Run** button (shown by default)                     |
| `no-copy-button`   | Hides the **Copy** button (shown by default)                    |

The **Run** button (types the block into the target terminal and executes it)
is shown for shell blocks — languages `bash`, `sh`, or `console` — and for
`prompt` blocks, unless `no-run-button` is set or the block has a `save-as`.

**`prompt` language.** A ` ```prompt ` block renders as plaintext (no syntax
highlighting) but keeps the **Run** button, so a learner can send a natural-
language prompt into the terminal — for example, into an AI agent session
(`then.session` in the simulator). Use it whenever the block's contents are a
prompt to type rather than a shell command.

````markdown
```prompt terminal-id=agent
Refactor the server to read the port from an environment variable.
```
````

**Directives** (via remark-directive) provide interactive elements:

| Directive              | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `:filelink[label]{path="app/server.js"}` | Link that `cat`s the file in a terminal          |
| `:tablink[label]{...}` | Opens/focuses a tab (a declared service, terminal, or ad-hoc URL) |
| `:variabledefinition`  | Defines/prompts for a `$$variable$$` value inline              |
| `:variablesetbutton`   | Button that sets a variable to a fixed value                   |
| `:conditionaldisplay`  | Shows/hides content based on a variable's value                |

---

## 6. `variables` — substitution values

A flat map of variable names to initial values. Anywhere `$$name$$` appears in
section markdown, it is replaced with the current value of that variable at
render time.

```yaml
variables:
  containerName: web
```

```markdown
docker run --name $$containerName$$ -d nginx
```

Substitution rules:

- `$$name$$` → the variable's current value. Whitespace inside the braces is
  trimmed (`$$ name $$` also works).
- If the variable is **unset or null**, the bare name is left in place (so
  `$$containerName$$` renders as `containerName`).
- `\$\$` escapes to a literal `$$` in the output.

Variables are held in memory and can be changed at runtime by the
`:variabledefinition` / `:variablesetbutton` directives (§5.1). The
`labspace.yaml` `variables:` map only provides the **initial** values.

---

## 7. `terminals` — terminal tabs

A list of terminal tabs shown in the right-hand pane. **All terminals share one
simulator instance** — the same state tree and the same virtual filesystem — so
they behave like multiple shells on one machine.

```yaml
terminals:
  - id: host
    title: Host
    icon: dns
  - id: agent
    title: Agent
    icon: smart_toy
```

| Field   | Required | Purpose                                                          |
| ------- | -------- | ---------------------------------------------------------------- |
| `id`    | no       | Stable id, referenced by `terminal-id=` in code blocks and by `when.terminal` in scenarios. Defaults to `slugify(title)`, then `terminal-<index>` |
| `title` | no       | Tab label (default `"Terminal"`)                                 |
| `icon`  | no       | [Material Symbols](https://fonts.google.com/icons) name (default `"terminal"`) |

Behaviour:

- If `terminals` is omitted or empty, a single default terminal is created:
  `{ id: "terminal", title: "Terminal", icon: "terminal" }`.
- The **first** terminal is the default focus target and the fallback for code
  blocks that omit `terminal-id`.
- Terminal tabs are **permanent** — they cannot be closed by the learner (only
  service/custom tabs can).
- A scenario in `simulator.yaml` can restrict itself to one terminal with
  `when.terminal: <id>` (see `simulator.md` §6.6). Because state and filesystem
  are shared, a command run in one terminal affects all of them.

---

## 8. `files` — virtual filesystem seed

A map of file path → contents used to seed the shared in-memory virtual
filesystem before any command runs. The built-in `ls` and `cat` commands (see
`simulator.md` §10) reflect these files immediately.

```yaml
files:
  app/server.js: |
    const express = require("express");
    const app = express();
    app.listen(3000);
  config/settings.yaml: |
    debug: true
```

- Keys are paths relative to the lab root; values are the full file contents.
- Seed files are the initial state; scenario `files:` effects and `save-as`
  code blocks mutate the same filesystem on top of this seed.
- Pressing **Reset** re-seeds the filesystem (and state) to these initial
  values.

---

## 9. `services` — external-URL tabs

Optional tabs that embed an external URL (as an iframe) alongside the terminal
tabs in the right-hand pane.

```yaml
services:
  - id: docs
    title: Documentation
    icon: menu_book
    url: https://docs.example.com
```

| Field   | Required | Purpose                                                    |
| ------- | -------- | ---------------------------------------------------------- |
| `id`    | no       | Stable id; referenced by `:tablink` directives. Defaults to `slugify(title)` |
| `title` | no       | Tab label (defaults to the `id`)                           |
| `icon`  | no       | Material Symbols name (default `"link"`)                   |
| `url`   | yes      | The URL loaded in the tab's iframe                         |

Behaviour:

- Declared services appear as tabs immediately after the terminal tabs.
- A `:tablink` directive whose target matches a declared service's `id`
  overrides that service tab's URL and focuses it; otherwise it opens a new
  ad-hoc tab. Service and ad-hoc tabs are closeable; terminal tabs are not.

> Note: external URLs are only reachable if the deployment/network policy allows
> them. Services are a presentation feature; the simulator itself never makes
> network calls.

---

## 10. `features` — optional built-in tabs

`features` is an optional map that turns on built-in, engine-backed tabs in the
right-hand pane. Unlike `services` (arbitrary external URLs), a feature tab is a
first-class component that reads the shared simulator state.

### 10.1 `features.ci` — the mock CI tab

Adds a **CI tab** that renders mock CI workflow runs, GitHub-Actions style. Runs
are triggered by scenarios via `then.ci` and defined by the `workflows:` catalog
— both owned by `simulator.yaml` (see `simulator.md` §15). The labspace only
declares that the tab exists and how it is labelled.

```yaml
features:
  ci:
    title: CI              # OPTIONAL tab label (default "CI")
    icon: rocket_launch    # OPTIONAL Material Symbols name (default "rocket_launch")
```

| Field   | Required | Purpose                                                     |
| ------- | -------- | ----------------------------------------------------------- |
| `title` | no       | Tab label (default `"CI"`)                                  |
| `icon`  | no       | Material Symbols name (default `"rocket_launch"`)           |

Behaviour:

- The CI tab appears immediately after the terminal tabs. It is **permanent**
  (not closeable), like a terminal tab.
- When a `git push` (or any scenario with `then.ci`) triggers a run, the CI tab
  is brought forward automatically so the learner sees the pipeline fire.
- Runs live in `state.ci.runs`, so they are deterministic and are cleared by
  **Reset** along with the rest of the state.
- With no `features.ci` block, no CI tab is shown and `then.ci` effects still
  write `state.ci.runs` but have no visible surface.

---

## 11. Worked example

```yaml
title: "Getting Started (Simulated)"
description: "A fully in-browser lab — every command is scripted and runs locally."

# Path to the simulator scenario spec (relative to this file). All terminals
# below share this one spec, plus one shared state + filesystem.
simulator: simulator.yaml

# Multiple terminal tabs, all backed by the shared simulator above. Code blocks
# can target a specific one with `terminal-id=<id>` in the fence info string;
# the first terminal is the default when a code block omits `terminal-id`.
terminals:
  - id: host
    title: Host
    icon: dns
  - id: agent
    title: Agent
    icon: smart_toy

# Seed files for the virtual filesystem. Built-in `ls`/`cat` reflect these.
files:
  app/server.js: |
    const express = require("express");
    const app = express();

    app.get("/", (_, res) => res.send("Hello from the lab!"));

    app.listen(3000, () => console.log("listening on :3000"));

sections:
  - title: Introduction
    contentPath: 00-intro.md
  - title: Run a container
    contentPath: 01-run.md
  - title: Edit and save a file
    contentPath: 02-edit.md
  - title: Work with the agent
    contentPath: 03-agent.md

variables:
  containerName: web
```

---

## 12. Relationship to `simulator.yaml`

| Concern                         | Owned by         |
| ------------------------------- | ---------------- |
| Lab title, description          | `labspace.yaml`  |
| Instruction sections / content  | `labspace.yaml`  |
| Terminal tabs (ids, labels)     | `labspace.yaml`  |
| Initial virtual filesystem      | `labspace.yaml` `files:` |
| External-URL (service) tabs     | `labspace.yaml`  |
| Built-in feature tabs (CI)      | `labspace.yaml` `features:` |
| Content variables               | `labspace.yaml` `variables:` |
| Command matching + effects      | `simulator.yaml` (`scenarios`) |
| Runtime state tree              | `simulator.yaml` `state:` |
| Command-facing controls/toggles | `simulator.yaml` `controls:` |
| CI workflow catalog + triggers  | `simulator.yaml` `workflows:` / `then.ci` |
| Streaming/pacing                | `simulator.yaml` `settings:` |

The two files meet at three points: `labspace.yaml`'s `simulator:` selects the
spec, `terminals[].id` supplies the ids used by `when.terminal`, and `files:`
seeds the filesystem that scenario `files:` effects and the built-in `ls`/`cat`
commands operate on.

---

## 13. Open questions / deferred

- Per-terminal (non-shared) simulator instances or isolated filesystems.
- Declaring initial state / variable overrides per section.
- Schema `version` field for `labspace.yaml` itself (currently unversioned).
- ~~Validation/lint for dangling `contentPath`, `terminal-id`, and service ids.~~
  Implemented by `app/scripts/validate-lab.ts` (`npm run validate-lab`), which
  checks `contentPath`, `simulator`, code-fence `terminal-id`, `:filelink`
  targets, and duplicate terminal/service ids.
