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

| Concern           | Lab                           | Deck                                      |
| ----------------- | ----------------------------- | ----------------------------------------- |
| `kind:`           | absent (or `lab`)             | `slides`                                  |
| Content list      | `sections:`                   | `slides:` (an alias — either is accepted) |
| `simulator:`      | **required**                  | **optional** — only needed for live demos |
| Content rendering | one continuous scrolling page | split into slides on `---`                |
| Presentation      | —                             | `theme:` and `brand:` (§9), per-slide config (§3.4) |

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

theme: light # default surface for every slide (§9)
brand: # branded chrome, set once (§9)
  logo: assets/docker-logo-deep-blue.svg
  eyebrow: "Containers 101"
  source: "DOCKER DEVELOPER PLATFORM · 2026"

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
(§8).

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

### 3.4 Per-slide config

A slide may open with an **HTML comment containing YAML**. It never renders, and
it configures how that slide is presented:

```markdown
<!--
layout: split
theme: dark
eyebrow: Multi-stage builds
logo: assets/docker-logo-white.svg
-->

# Every layer you skip is time you get back
```

The one-line form works too: `<!-- layout: split -->`.

| Key       | Purpose                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `layout`  | One of §5's layouts. Default `default`.                                    |
| `theme`   | `light` · `dark` · `tint`. See §9 for how the default is chosen.            |
| `eyebrow` | Top-right label. `""` suppresses the deck default.                         |
| `source`  | Bottom-left citation. `""` suppresses the deck default.                    |
| `byline`  | Replaces `source` in the footer on a `title` layout.                       |
| `logo`    | Overrides the deck logo — a dark surface needs the reversed mark. Slide-relative. |
| `chrome`  | `false` hides both bands entirely on this slide.                           |

Why a comment and not the obvious alternatives:

- **Not YAML front matter.** `---` is already the slide separator.
- **Not a `Layout:` magic line.** Config would then collide with prose that
  happens to begin the same way.
- A comment is invisible to every other markdown renderer, and it is one of the
  few forms Prettier provably leaves alone — see the warning in §3.5.

Only a comment that **opens** the slide is config, so ordinary comments further
down stay ordinary. A malformed block is reported by `validate-lab` and ignored at
runtime: a typo must not blank a slide mid-presentation.

### 3.5 `<!-- region -->` — splitting a slide into columns

`layout: split` divides a slide at each `<!-- region -->` marker:

```markdown
<!-- layout: split -->

# Where developer time actually goes

<!-- region -->

### The problem

<!-- region -->

### The fix
```

- With **two** regions, both are columns.
- With **three or more**, the first is a full-width **header band** and the rest
  are columns. That one rule covers both a spanning headline above two columns and
  a headline that lives inside the left column.
- A marker inside a fenced code block is content, not a break.
- On any layout other than `split`, regions are joined back together — the break
  does nothing, and `validate-lab` warns.

> [!IMPORTANT]
> The region marker is a comment rather than markdown's other thematic break,
> `***`, because **Prettier rewrites `***` and `___` to `---`** — the slide
> separator. A formatting pass would silently split one slide into two. For the
> same reason `app/.prettierignore` excludes lab and deck content entirely.

## 4. Navigation

| Input                            | Action                                          |
| -------------------------------- | ----------------------------------------------- |
| `→`, `Space`, `PageDown`, click  | Next fragment, else next slide                  |
| Swipe left                       | Next fragment, else next slide                  |
| `←`, `PageUp`                    | Previous fragment, else previous slide          |
| Swipe right                      | Previous fragment, else previous slide          |
| `Home` / `End`                   | First / last slide                              |
| `p`                              | Toggle **present mode** (§4.1)                  |
| `f`                              | Toggle browser fullscreen                       |
| `s`                              | Toggle the speaker-notes window                 |
| `Esc`                            | Exit present mode                               |
| `Esc` (while in a demo terminal) | Return keyboard control to the deck             |

Clicking the slide **background** advances. A click on a link, button, or the demo
terminal is that element's own business.

**On a touch device, swipe horizontally to move through the deck** — the same
sequence the arrow keys walk, fragments included. A swipe that starts inside the
demo terminal belongs to the terminal (its transcript scrolls), as a keystroke there
does, and so does one that starts on something panning sideways, such as a wide code
block. Vertical scrolling and pinch-zoom are untouched: a phone shows a 16:9 slide
small, and zooming in to read it still works.

**The navigation keys work in the presenter window too** (§8), so a presenter
watching their notes never has to reach back to the other screen. Both windows
share one key mapping, so they cannot disagree about what an arrow does.

### 4.1 Present mode

`p`, or the play button in the toolbar, hides the app's own chrome and lets the
slide fill the window — **without** entering browser fullscreen. `Esc` or `p`
exits.

Both exist because they serve different jobs. Real fullscreen (`f`) is for
presenting to a room. Present mode is for **capture**: a screen recorder or
screenshot of the window then contains the slide and nothing else, with no toolbar
to crop and no fullscreen mode some capture tools can't read. The slide's rounding
and shadow are dropped and the letterbox bars go dark, so the frame is all slide.

A hint appears briefly on entry and then removes itself — a permanent "press Esc"
badge would end up in the very captures the mode exists for.

---

## 5. Layouts

`layout:` in a slide's config selects one of six arrangements. Everything else
about the slide is ordinary markdown.

| Layout    | Shape                                                            | Default theme |
| --------- | ---------------------------------------------------------------- | ------------- |
| `default` | Heading, then content flowing beneath it. The workhorse.          | deck default  |
| `title`   | The opener: vertically centred, largest type, byline in the footer | `dark`        |
| `section` | A chapter divider: eyebrow, oversized title, one supporting line   | `tint`        |
| `split`   | Regions as equal columns, optionally under a header band (§3.5)    | deck default  |
| `stats`   | Heading, then the slide's `:::stat` blocks side by side            | deck default  |
| `quote`   | A pull quote at billboard size, with attribution                   | deck default  |

Notes on the ones with conventions attached:

- **`title` and `section`** treat the paragraph directly after the `#` heading as a
  standfirst — larger than body copy, and on a `section` in the accent colour.
- **`quote`** renders an ordinary markdown blockquote; the quote mark is generated.
  The paragraph after it is the attribution, so `**Name**` on its own line becomes
  the emphasised first line.
- **`stats`** gives each `:::stat` an equal share of the row whatever the count,
  wrapping when there are too many to read.

An unrecognised layout falls back to `default` and is an error from
`validate-lab` — a typo shows a plain slide rather than nothing.

### 5.1 Sizing: a fluid 16:9 canvas

The slide is a 16:9 box that fills whichever viewport axis binds first, and every
type size in the theme is expressed in **`cqi`** (container query units — 1cqi is
1% of the slide's width). A designed layout therefore holds its proportions at any
display size, from a laptop to a hall projector.

This is deliberately **not** the fixed-canvas-plus-`transform: scale()` approach a
slide tool usually takes. Scaling a transformed subtree renders text blurry at
non-integer scales and makes the caret and text selection unreliable inside the
live demo terminal — and it turns content that doesn't fit into a hard clip rather
than something that can scroll.

Practical consequence for authors: sizes in this theme are derived from a
1920px-wide reference canvas divided by 19.2. `::terminal{height=300}` means "300px
on a 1920 canvas", not 300 physical pixels.

### 5.2 The type scale

Every size in the theme references a named scale declared on the slide canvas, so
retuning the deck's typography is a matter of changing these values rather than
hunting through the stylesheet:

| Custom property    | Default  | Used by                                        |
| ------------------ | -------- | ---------------------------------------------- |
| `--deck-fs-hero`   | `5.6cqi` | `title`/`section` headline, a stat's number      |
| `--deck-fs-h1`     | `4cqi`   | a content slide's headline                       |
| `--deck-fs-h2`     | `2.5cqi` | `h2`, and a `quote`                              |
| `--deck-fs-h3`     | `2cqi`   | `h3` — usually a column's main statement          |
| `--deck-fs-lead`   | `1.7cqi` | the standfirst under a title/section headline     |
| `--deck-fs-body`   | `1.45cqi`| prose and list items — the default               |
| `--deck-fs-small`  | `1.25cqi`| card bodies, table cells, stat captions          |
| `--deck-fs-code`   | `1.1cqi` | code blocks                                      |
| `--deck-fs-micro`  | `0.85cqi`| eyebrow, footer, labels, tags                    |

Body copy sits deliberately above the reference deck's equivalent (its two-column
list is 24px, or 1.25cqi): that deck is sized for a projector, whereas these are
also read at laptop size in a browser window.

Two structural rules make the scale mean what it says, and both are easy to undo
by accident:

- **The canvas carries no padding** — an inner frame does. Container query units
  resolve against the container's *content* box, so padding on the canvas would
  make every `cqi` a percentage of a narrower box and render the whole scale
  small.
- **No `cqi` font-size on the canvas itself** — a container never queries itself,
  so such a value resolves against the enclosing stage and disagrees with every
  descendant. The base size lives on the frame.

## 6. Components

Three container/text directives cover the non-code blocks on a slide. They're
deliberately few: the nine archetypes a design system would enumerate are the same
shape wearing different paint — a label, a body, an accent — so they collapse into
one card with variants.

### 6.1 `:::stat` — a headline number

```markdown
:::stat{value="20B+"}
Docker Hub pulls per month across every language and stack
:::
```

| Attribute | Purpose                                   |
| --------- | ----------------------------------------- |
| `value`   | The oversized number                      |
| `label`   | Optional small uppercase label above it   |
| `accent`  | Accent colour (§6.4)                      |

### 6.2 `:::card` — a panel

```markdown
:::card{label="sync action" accent=green variant=fill}
Copies changed files into the running container without rebuilding the image.
:::
```

| Attribute | Purpose                                                         |
| --------- | --------------------------------------------------------------- |
| `label`   | Small uppercase label above the body                            |
| `accent`  | Accent colour (§6.4)                                            |
| `variant` | `rule` (default — accent bar on the left) · `fill` · `outline`   |

`rule` is the default because it's the lightest: a slide of filled boxes reads as
a form. Inside a card, list bullets become arrows.

### 6.3 `:tag` — an inline pill

```markdown
:tag[Before]{accent=red}
```

A text directive (single colon), so it sits in a paragraph — which is how a
before/after slide labels each code sample.

### 6.4 Accents

`blue` (default) · `green` · `red` · `amber` · `neutral`. Each resolves to a line,
fill, and text colour, and each has a brighter variant applied automatically on a
dark surface. An unrecognised value falls back to `blue`.

### 6.5 `filename=` on a code fence

```` ```yaml filename=compose.yaml highlight=4-11 ```` labels the block's header
with a filename instead of its language — the code-window look. Purely a label:
unlike `save-as`, it writes nothing to the virtual filesystem. Quotes are optional
and allow spaces (`filename="Dockerfile · optimized"`).

## 7. `::terminal` — live demos on a slide

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

### 7.1 Keyboard ownership

While focus is inside a demo terminal, **the terminal owns every keystroke** —
otherwise typing `docker ps` would flip slides on the space. The consequence is
that the arrow keys stop advancing the deck, so `Esc` hands control back (the
panel shows an "Esc to leave" hint while focused), and clicking the slide
background also works.

### 7.2 Sharing the lab's simulator

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

## 8. Speaker notes (the presenter window)

`s`, or the notes button in the chrome, opens a second browser window with the
current slide's notes, a preview of the next slide, and an elapsed timer (click to
reset).

It is rendered through a React portal, so it tracks the deck live — advancing on
the projector updates it with no synchronisation of its own. Closing either window
docks it back.

**It drives the deck, not just displays it.** The navigation keys from §4 work in
this window, and there are Previous/Next buttons. A keydown in a separate window
never reaches the opener, so this window binds its own listener over the shared key
mapping — without that the presenter view would be read-only. `Esc` closes it.

Requires pop-ups to be allowed for the site; when blocked, the button simply
un-toggles.

---

## 9. Theme and brand chrome

There is one theme — Docker — with three surfaces. A deck sets its defaults once in
`labspace.yaml`:

```yaml
kind: slides
theme: light # surface every slide starts from

brand:
  logo: assets/docker-logo-deep-blue.svg # slide-relative
  eyebrow: "A Tour of Docker" # top-right label
  source: "DOCKER DEVELOPER PLATFORM · 2026" # bottom-left citation
```

| Surface | Use                                                                 |
| ------- | ------------------------------------------------------------------- |
| `light` | Body-copy white. Content slides.                                     |
| `dark`  | Deep blue with the brand wave background. Openers, quotes, emphasis.  |
| `tint`  | Light blue. Chapter dividers.                                        |

**Theme precedence** is: the slide's own `theme:`, then the **layout's** default
(§5), then the deck default, then `light`. The layout default deliberately
outranks the deck default — a deck-wide `theme: light` means "content slides are
light", and letting it outrank the layout would flatten every chapter divider back
to white, which is the one thing a divider exists not to be.

**Chrome.** The top band carries the logo and eyebrow; the bottom band carries the
source (or a `title` slide's `byline`) and an automatic zero-padded page number.
A slide overrides any of them, suppresses one with `""`, or drops both bands with
`chrome: false`.

**Brand assets are slide-relative**, like every other path in a lab, so a deck
carries its own logo and stays a portable, self-contained bundle. Absolute paths
and full URLs pass through untouched.

**Fonts.** The theme sets display type in **Inter** and mono in **Roboto Mono**,
both of which the app already ships. The reference design uses ABC Repro, a
licensed face; using what's already bundled means the theme carries no font
licensing question and no extra download.

## 10. Progress and tracking

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

## 11. Relationship to the other specs

| Concern                                  | Owned by                             |
| ---------------------------------------- | ------------------------------------ |
| `kind`, and the generated card metadata  | `catalog.md`                         |
| Title, variables, files, terminals, tracking | `labspace.md`                    |
| Slide splitting, config, regions, layouts, components, theme | this document    |
| Command matching + effects               | `simulator.md` (`scenarios`)         |

---

## 12. Open questions / deferred

- **Collections.** `catalog.order` already puts the deck before its lab, but there
  is no first-class "this deck and this lab are one workshop" grouping — no
  landing-page section headers and no "Continue to the lab →" hand-off on the last
  slide. Deferred deliberately; it's additive.
- **Print / PDF export.** `#/export` renders a lab's sections; the equivalent for
  a deck (all slides, fragments revealed, notes optionally included) is not built.
- **Transitions and an overview mode.** Neither exists. The slide layer is
  hand-rolled — see `docs/slidedeck-exploration.md` §6 for why — and these are the
  two things a library would have given us.
- **A second theme.** The theme is Docker-only and its tokens are hard-coded in
  `DeckView.scss`. They're already CSS custom properties scoped to `.deck-canvas`,
  so an author-selectable theme is a matter of where the values come from, not a
  restructure.
- **Three equal prose columns.** `split` reads 3+ regions as "header + columns", so
  a header-less three-column slide can't be expressed. No design in the reference
  needs one.
- **Overflow is invisible until it happens.** A region scrolls rather than clipping,
  but nothing warns an author at validate time that a slide's content doesn't fit —
  it depends on the viewport. A dev-mode overlay would be the cheap fix.
- **Slide ids shift** when a slide is inserted mid-chapter (§3.1). A stable
  author-assigned id per slide would fix it at the cost of authoring noise.
