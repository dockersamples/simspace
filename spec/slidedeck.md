# Slide decks — `kind: slides` Specification

**Status:** Draft

This document specifies the **slide deck**: a catalog entry that presents markdown
as slides rather than as a lab. A deck is the "here's the idea" half of a
workshop, and the lab is the "now you try it" half; shipping both from one repo is
the point.

A deck is **the same `labspace.yaml` format as a lab** (see `labspace.md`) with
`kind: slides`. Everything a lab can declare — title, variables, files, terminals,
services, tracking — means the same thing in a deck. Only three things differ, and
they're all in §2.

---

## 1. Core model

```
                ┌────────────────────────────────────────────────┐
  page load  ─► │ 1. read labs.json; pick the entry (id, or sole) │
                │ 2. `kind` decides the view: lab or slides       │
                │ 3. fetch + parse labspace.yaml                  │
                │ 4. fetch the referenced simulator (if any)      │
                │ 5. fetch each chapter's markdown               │
                │ 6. split each chapter into slides on `---`      │
                │ 7. render one slide at a time, full-bleed       │
                └────────────────────────────────────────────────┘
```

- **Chapters are an authoring convenience; the deck is flat.** Each entry under
  `slides:` is one markdown file holding several slides. The presented deck is the
  concatenation, numbered `1 / N`.
- **The URL is the position.** A slide's id is the route segment
  (`#/labs/<id>/<slide-id>`), so deep links, reload, and the back button all work
  with no second copy of "current slide" to keep in sync.
- **Decks live under `labs/` and appear in `labs.json`** alongside labs. The
  directory name is the id, the storage namespace, and pulse's `labId` — exactly
  as for a lab.

---

## 2. What differs from a lab

| Concern           | Lab                            | Deck                                        |
| ----------------- | ------------------------------ | ------------------------------------------- |
| `kind:`           | absent (or `lab`)              | `slides`                                    |
| Content list      | `sections:`                    | `slides:` (an alias — either is accepted)   |
| `simulator:`      | **required**                   | **optional** — only needed for live demos   |
| Content rendering | one continuous scrolling page  | split into slides on `---`                  |

Everything else is identical, which is why one loader and one provider stack serve
both. In particular `variables`, `files`, `terminals`, `services`, `tracking`, and
`version` behave exactly as `labspace.md` describes.

### 2.1 Worked example

```yaml
# labs/containers-101-slides/labspace.yaml
kind: slides
title: "Containers 101"
description: "The 20-minute version, before you get your hands dirty."

catalog:
  icon: slideshow # the default for a deck, so this line is optional
  order: 1 # deck first, lab second, on the landing page
  estimatedMinutes: 20

version: "1.0.0"

# OPTIONAL. Point at the SIBLING LAB's spec so the demos on these slides run the
# exact commands the learners will run themselves — see §5.
simulator: ../containers-101/simulator.yaml

terminals:
  - id: demo
    title: Demo
    icon: terminal

slides:
  - title: Opening
    contentPath: 00-opening.md
  - title: The CLI
    contentPath: 01-cli.md
```

---

## 3. Slide markdown

A chapter file is ordinary markdown. Slides are separated by a line containing
only `---`:

```markdown
# Why containers?

Ship the environment, not just the code.

---

## Three primitives

- Image
- Container
- Registry
```

Rules:

- The separator must be a line of **exactly three dashes** (leading/trailing
  whitespace allowed). Four or more (`----`) is a horizontal rule, so a slide can
  still contain an `<hr>`.
- A `---` **inside a fenced code block is content**, never a break — so YAML
  documents, diff hunks, and heredocs are safe. Longer fences (` ```` `) nest
  correctly, which is how a slide shows a code fence to the reader.
- A `---` on the **first line** of a file opens YAML front matter, not a slide.
- Empty chunks are dropped, so a stray or trailing separator adds no blank slide.
- **The whole lab authoring surface works on a slide**: GFM, mermaid, GitHub
  alerts, `$$variable$$` substitution, code-fence meta (`terminal-id=`,
  `highlight=`, `no-run-button`, …), and the `:filelink` / `:tablink` /
  `:variabledefinition` / `:variablesetbutton` / `:conditionaldisplay`
  directives. See `labspace.md` §5.1.

### 3.1 Slide ids

Each slide's id is `<chapter-id>-<n>`, numbered from 1 within its chapter
(`opening-1`, `opening-2`, `the-cli-1`, …). The chapter id is `slugify(title)`, or
`chapter-<n>` when the chapter has no title.

Ids are **positional, not derived from headings**, for two reasons: slides are
frequently untitled (an image, one line of text), and renaming a heading must not
silently invalidate a learner's recorded progress or break a shared deep link.

Adding or removing a slide **does** shift the ids after it. Bump `version:` when
you do, so stale progress is invalidated rather than mis-attributed (§4.1 of
`labspace.md`).

### 3.2 `Note:` — speaker notes

A line beginning `Note:` and everything after it, to the end of the slide, is
speaker notes. It never renders on the slide; it appears in the presenter window
(§6).

```markdown
## Three primitives

- Image
- Container
- Registry

Note: This is the slide people photograph. Leave it up while you explain, and
resist adding rows — three is the point.
```

A slide with notes and no body is legal: a deliberate "say this, show nothing"
beat.

### 3.3 `:::fragment` — incremental reveal

A `:::fragment` container is revealed on the next forward press instead of with
the slide. Fragments reveal in document order; you never number them.

```markdown
## Why containers?

Ship the environment, not just the code.

:::fragment
The same image runs on a laptop, in CI, and in production.
:::

:::fragment
"Works on my machine" stops being a sentence anybody says.
:::
```

Behaviour:

- Forward advances through the slide's fragments, then to the next slide; back
  rewinds them. Stepping **back** onto a slide shows it fully revealed — going
  back should show what you already saw, not replay the build.
- Hidden fragments keep their space in the layout (`visibility`, not `display`),
  so revealing one never reflows what's already on screen.
- Fragment state is **not** in the URL: it's a beat within a slide, not a place,
  and history entries for it would be noise.
- Outside a live deck — in a lab, the print/export view, or the presenter
  window's "up next" preview — fragments render **fully revealed**.

---

## 4. Navigation

| Input                              | Action                                    |
| ---------------------------------- | ----------------------------------------- |
| `→`, `Space`, `PageDown`, click    | Next fragment, else next slide            |
| `←`, `PageUp`                      | Previous fragment, else previous slide     |
| `Home` / `End`                     | First / last slide                        |
| `f`                                | Toggle fullscreen                         |
| `s`                                | Toggle the speaker-notes window           |
| `Esc` (while in a demo terminal)   | Return keyboard control to the deck       |

Clicking the slide **background** advances. A click on a link, button, or the demo
terminal is that element's own business.

---

## 5. `::terminal` — live demos on a slide

`::terminal{id=demo height=340}` embeds a simulated terminal in a slide.

```markdown
## Start a container

```bash terminal-id=demo
docker run -d --name web -p 8080:80 nginx
```

::terminal{id=demo height=300}
```

| Attribute | Required | Purpose                                                        |
| --------- | -------- | -------------------------------------------------------------- |
| `id`      | no       | Which declared terminal this is. Falls back to the primary one. |
| `height`  | no       | Pixel height of the panel (default `320`).                     |

Behaviour:

- The code fence above it keeps its normal **Run** button; `terminal-id=` targets
  this terminal. Clicking Run is preferable to typing during a talk — the output
  is paced by the author and typing races it.
- **All terminals in a deck share one simulator**, so demo state accumulates
  across slides: a container started on slide 4 is still running on slide 9.
- **The transcript is per-slide; the machine is not.** Moving between slides
  remounts the panel, so each demo slide starts with a clean screen against a
  live machine — which is usually exactly what you want mid-talk.
- Nothing is persisted: reopening the deck starts from a fresh machine. A
  presenter who rehearsed does not inherit last night's state. The panel's reset
  button re-seeds mid-session.
- The pop-out button moves the terminal into a second browser window (deck on the
  projector, terminal on the laptop). It is the *same* terminal, rendered through
  a portal — not a copy.
- With no `simulator:` declared, the directive renders an explanation instead of
  an inert black box.

### 5.1 Keyboard ownership

While focus is inside a demo terminal, **the terminal owns every keystroke** —
otherwise typing `docker ps` would flip slides on the space. The consequence is
that the arrow keys stop advancing the deck, so `Esc` hands control back (the
panel shows an "Esc to leave" hint while focused), and clicking the slide
background also works.

### 5.2 Sharing the lab's simulator

The recommended pattern is to point at the sibling lab's spec:

```yaml
simulator: ../containers-101/simulator.yaml
```

The demos then run the same scripted commands the learners will run, so the two
cannot drift apart. Paths resolve relative to the `labspace.yaml`, so `../` works.

Two consequences worth knowing:

- The lab's terminal ids are part of that contract. Scenarios scoped with
  `when.terminal: <id>` only fire in a terminal with that id, so a deck declaring
  only `demo` will not fire the lab's `sandbox`-scoped scenarios.
- `validate-lab` recognizes a shared spec (a `simulator:` path outside the entry's
  own directory) and **skips** the `when.terminal` and `completes:` cross-checks
  for it — those ids belong to the entry that owns the spec and are validated
  there.

**State is not shared.** Each entry keeps its own `simspace:engine:<id>`
namespace, so a learner does not arrive at the lab with the demo's containers
already running. Only the spec is reused.

---

## 6. Speaker notes (the presenter window)

`s`, or the notes button in the chrome, opens a second browser window with the
current slide's notes, a preview of the next slide, and an elapsed timer (click to
reset).

It is rendered through a React portal, so it tracks the deck live — advancing on
the projector updates it with no synchronisation of its own. Closing either window
docks it back.

Requires pop-ups to be allowed for the site; when blocked, the button simply
un-toggles.

---

## 7. Progress and tracking

A deck is tracked **exactly like a lab**, so the catalog badge and the instructor
dashboard need no per-kind logic:

- Every slide change reports `section_viewed` with the **slide** id. Pulse needs
  no new event shape and its queries are unchanged.
- Reaching the **last slide** marks the deck complete (`lab_completed` plus the
  local marker behind the catalog's "Completed" chip). It fires on *reaching* the
  final slide rather than on reading it — there's no honest signal for the latter,
  and requiring one more press past the end would mean most decks never counted.
- Decks declare no `steps:`, so no step-level progress is recorded. `tracking:
  false` opts a deck out entirely, as for a lab (`labspace.md` §10.2).

---

## 8. Relationship to the other specs

| Concern                                  | Owned by                             |
| ---------------------------------------- | ------------------------------------ |
| `kind`, and the generated card metadata  | `catalog.md`                         |
| Title, variables, files, terminals, tracking | `labspace.md`                    |
| Slide splitting, `Note:`, `:::fragment`, `::terminal` | this document           |
| Command matching + effects               | `simulator.md` (`scenarios`)         |

---

## 9. Open questions / deferred

- **Collections.** `catalog.order` already puts the deck before its lab, but there
  is no first-class "this deck and this lab are one workshop" grouping — no
  landing-page section headers and no "Continue to the lab →" hand-off on the last
  slide. Deferred deliberately; it's additive.
- **Print / PDF export.** `#/export` renders a lab's sections; the equivalent for
  a deck (all slides, fragments revealed, notes optionally included) is not built.
- **Transitions and an overview mode.** Neither exists. The slide layer is
  hand-rolled — see `docs/slidedeck-exploration.md` §6 for why — and these are the
  two things a library would have given us.
- **Per-slide configuration** (background, layout, theme) has no syntax yet.
- **Slide ids shift** when a slide is inserted mid-chapter (§3.1). A stable
  author-assigned id per slide would fix it at the cost of authoring noise.
