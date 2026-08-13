---
name: authoring-slidedeck
description: Author or edit a Simspace slide deck (an entry with `kind: slides`) — slides, layouts, the Docker theme, speaker notes, fragments, stat/card components, or an in-slide live demo terminal. Use whenever building presentation slides to accompany a lab, or editing a deck's markdown or its labspace.yaml.
---

# Authoring a Simspace slide deck

You are editing a **slide deck**: the same `labspace.yaml` format as a lab, with
`kind: slides`. It lives beside the lab under `labs/<id>/`, ships in the same
build, and appears as its own card on the landing page — so the slides and the
hands-on part of one workshop are a single repo and a single deploy.

If you're editing command behaviour (`simulator.yaml` scenarios), use the
**authoring-lab** skill instead; that's the same for a deck as for a lab. This
skill is the presentation surface.

**Converting a deck from PowerPoint, Google Slides, Keynote, or a PDF?** Start
with the **importing-slidedeck** skill — it covers reading the source's structure
and mapping each slide onto the layouts below. Come back here for the details of
whatever it tells you to write.

## The loop (identical to a lab)

```bash
docker compose run --rm validate   # ALWAYS before finishing
docker compose up dev              # preview at http://localhost:5173
```

The PostToolUse hook validates automatically after any edit under `labs/`, decks
included. **Definition of done:** validation green, and you've eyeballed the deck
in the preview — layouts are visual, and a slide that overflows or a heading that
lands wrong only shows up on screen.

Open a deck at `#/labs/<id>/` and step with `→`/`←`.

| Key   | Does                                                                 |
| ----- | -------------------------------------------------------------------- |
| `s`   | Presenter window — notes, next slide, timer. **Arrow keys work there too.** |
| `p`   | Present mode: hides the toolbar, slide fills the window. `Esc` exits. |
| `f`   | Browser fullscreen                                                   |

Use `p` rather than `f` when capturing a screenshot or recording of a slide — the
window then contains the slide and nothing else, with no toolbar to crop out.

## A deck's labspace.yaml

```yaml
kind: slides # the only required difference from a lab
title: "Containers 101"
description: "The 20-minute version, before you get your hands dirty."

catalog:
  order: 1 # deck first, lab second, on the landing page
  estimatedMinutes: 20

version: "1.0.0" # bump when you add or remove slides (see Gotchas)

theme: light # default surface for every slide
brand: # branded chrome, set ONCE here
  logo: assets/docker-logo-deep-blue.svg # slide-relative path
  eyebrow: "Containers 101" # top-right label
  source: "DOCKER · 2026" # bottom-left citation

# OPTIONAL for a deck — only needed if a slide runs a live demo. Point at the
# SIBLING LAB's spec so the demos run the exact commands learners will run.
simulator: ../containers-101/simulator.yaml
terminals:
  - id: demo

slides: # alias of `sections:` — one file per chapter
  - title: Opening
    contentPath: 00-opening.md
```

## Writing slides

One file per chapter; slides are separated by a line of exactly `---`.

````markdown
<!--
layout: split
theme: dark
eyebrow: Multi-stage builds
logo: assets/docker-logo-white.svg
-->

# Every layer you skip is time you get back

<!-- region -->

:tag[Before]{accent=red}

```dockerfile filename="Dockerfile · naive" highlight=2
FROM golang:1.22
COPY . .
```

<!-- region -->

:tag[After]{accent=green}

:::card{label="Result" accent=green}

- Runtime image is ~8 MB
- Deps layer cached across builds

:::

Note: The highlighted line is the whole point. If you only have time for one code
slide, it's this one.
````

Four things are doing work there:

- **`<!-- … -->` config** opens the slide. YAML inside a comment; a one-liner
  (`<!-- layout: split -->`) works too. Only a comment that *opens* the slide is
  config, so ordinary comments further down stay ordinary.
- **`<!-- region -->`** splits a `split` layout into columns.
- **`Note:`** and everything after it is speaker notes — never rendered on the
  slide, shown in the presenter window.
- **`:::card` / `:tag`** are components (below).

## Layouts

| `layout:`            | Shape                                                    |
| -------------------- | -------------------------------------------------------- |
| `default` _(if omitted)_ | Heading, then content flowing beneath. The workhorse. |
| `title`              | Opener: centred, largest type, `byline:` in the footer    |
| `section`            | Chapter divider: eyebrow, huge title, one supporting line |
| `split`              | Regions as columns, equal unless `columns:` says otherwise |
| `stats`              | Heading, then `:::stat` blocks side by side               |
| `quote`              | A pull quote at billboard size, with attribution          |
| `image`              | Full-bleed picture with the words in a panel over it      |

**`split` region rule** — the one thing to get right:

- **Two** regions → both are columns.
- **Three or more** → the first is a full-width **header band**, the rest are
  columns. Use this when a headline should span above two columns.

So a spanning headline needs a `<!-- region -->` after it:

```markdown
<!-- layout: split -->

# Spans both columns

<!-- region -->

left

<!-- region -->

right
```

**Unequal columns** — `columns:` weights a `split` instead of halving it:

```markdown
<!--
layout: split
columns: 1 2
-->

# A narrow label against a wide description
```

Weights are relative (`1 2` = `50 100`) and apply to the **columns**, so a slide
with a header band takes one weight per column, not per region. A ratio that
doesn't match the column count is ignored and `validate` warns.

**An image-led slide** — `layout: image` bleeds a picture to the canvas edge:

```markdown
<!--
layout: image
image: assets/keynote-stage.jpg
alt: "The keynote stage, mid-demo, from the back of the hall"
logo: assets/docker-logo-white.svg
-->

# The Docker Zone

Build what's next — an instruction, not a slogan.
```

- `image:` is **required**, and it's config rather than an `![](…)` in the body:
  a markdown image is a figure inside the text flow, which is the right thing for
  a diagram but can't reach the edge of the slide. Both are supported; pick by
  whether the picture *is* the slide or sits *on* it.
- `alt:` describes the picture. It's the slide's content here, so `validate`
  warns without it.
- The picture is cropped to fill (`cover`), not letterboxed.
- Heading and body are optional — omit both for a slide that's only a picture,
  and add `chrome: false` for a true full-bleed frame.

Conventions attached to specific layouts:

- `title` and `section` treat the paragraph right after the `#` heading as a
  standfirst — larger than body copy, and accent-coloured on a `section`.
- `quote` renders a normal `>` blockquote (the quote mark is generated). The
  paragraph after it is the attribution, so `**Name**` on its own line becomes the
  emphasised first line.
- `stats` gives each `:::stat` an equal share of the row, whatever the count.

## Config keys

| Key       | Effect                                                                 |
| --------- | ---------------------------------------------------------------------- |
| `layout`  | One of the seven above. Default `default`.                              |
| `columns` | Column weights for a `split`, e.g. `1 2`. Default: equal.               |
| `image`   | Full-bleed picture for `layout: image` (slide-relative). Required there. |
| `alt`     | Description of that picture.                                            |
| `theme`   | `light` · `dark` · `tint`                                              |
| `eyebrow` | Top-right label. `""` suppresses the deck default.                      |
| `source`  | Bottom-left citation. `""` suppresses the deck default.                 |
| `byline`  | Replaces `source` in the footer on a `title` layout                     |
| `logo`    | Overrides the deck logo — **a dark slide needs the reversed (white) mark** |
| `chrome`  | `false` hides both bands on this slide                                  |

**Theme defaults:** `title` and `image` default to `dark`, `section` to `tint`, and those
beat the deck-wide `theme:`. So a deck set to `light` still gets branded chapter
markers; say `theme: light` on the slide itself if you want a pale divider.

## Components

Three directives cover every non-code block. Don't reach for raw HTML — these
carry the theme's accents and scale with the slide.

```markdown
:::stat{value="20B+"}
Docker Hub pulls per month
:::

:::card{label="sync action" accent=green variant=fill}
Copies changed files into the container without rebuilding.
:::

:tag[Before]{accent=red}
```

- **`:::stat`** — `value` (the big number), optional `label`, `accent`.
- **`:::card`** — `label`, `accent`, and `variant`: `rule` (default, accent bar on
  the left), `fill`, or `outline`. Lists inside a card get arrow bullets. Prefer
  `rule`; a slide of filled boxes reads as a form.
- **`:tag[text]`** — an inline pill, for labelling a column or a code sample.
- **Accents:** `blue` (default) · `green` · `red` · `amber` · `neutral`. Each has a
  brighter variant applied automatically on a dark slide.

## Incremental reveal

```markdown
:::fragment
This appears on the next press.
:::
```

Fragments reveal in document order — never number them. Forward steps through a
slide's fragments before moving on; stepping *back* onto a slide shows it fully
revealed. Outside a live deck (the presenter window's "next slide" preview) they
render revealed, so nothing is ever hidden by accident.

## Live demo terminals

````markdown
<!-- layout: split -->

# Start a container

<!-- region -->

```bash terminal-id=demo
docker run -d --name web -p 8080:80 nginx
```

<!-- region -->

::terminal{id=demo height=300}
````

- **`terminal-id=` is what gives a fence its Run button on a slide.** Unlike a
  lab, slide code fences have no Run button by default — slide code is nearly
  always a sample being read, not a command. So `no-run-button` is unnecessary
  here, and a plain ` ```dockerfile ` block is just a sample, as intended.
- Requires `simulator:` and a matching `terminals:` id in `labspace.yaml`. Without
  one, the directive renders an explanation instead of a dead black box.
- **All terminals in a deck share one machine**, so demo state accumulates across
  slides: a container started on slide 4 is still running on slide 9. Each slide
  starts with a clean *screen* but a live machine.
- **Click Run rather than typing during a talk** — output is paced by the author
  and typing races it.
- `height` is in the theme's reference units (pixels on a 1920-wide slide), so it
  scales with the display rather than staying a fixed block.
- Nothing persists: reopening the deck starts from a fresh machine, so rehearsing
  doesn't leave state behind. The panel has a reset button too.

## Gotchas

- **A dark slide needs `logo:` set to the white mark.** The deck-level logo is the
  dark one; on a dark surface it's invisible. This is the single most common
  authoring mistake.
- **Region markers only mean something to `layout: split`.** Anywhere else the
  regions are joined back together and `validate` warns.
- **Slide ids are positional** (`<chapter-id>-<n>`), so inserting a slide
  mid-chapter shifts the ids after it. Bump `version:` when you do, so stale
  learner progress is invalidated rather than mis-attributed.
- **`---` is the slide separator.** Four or more dashes (`----`) is a horizontal
  rule if you need one. If you ever add a markdown formatter to this repo,
  **exclude `labs/`** — Prettier and friends rewrite `***` and `___` to `---`,
  which would silently split one slide into two.
- **Layouts are visual.** Validation can't tell you a slide is overcrowded or that
  a heading wrapped badly. Look at it in the preview.
- **Terminal output on a slide should be real output** — a projector is where a
  made-up column header or a non-existent flag gets noticed. Nothing validates it,
  so check [`dockersamples/sample-cli-output`](https://github.com/dockersamples/sample-cli-output)
  (per tool and version: live `--help` plus real example output) before writing a
  sample fence or a demo scenario. See the **authoring-lab** skill for how to use it.
- **Sharing a lab's `simulator.yaml` is the recommended pattern.** `validate`
  knows the spec isn't yours and won't complain about terminal ids or `completes:`
  step ids that belong to the lab.

## Adding a deck to an existing lab

1. Create `labs/<lab-id>-slides/` beside the lab.
2. Add `labspace.yaml` with `kind: slides`, `catalog.order: 1` (so it sorts before
   the lab), and `simulator: ../<lab-id>/simulator.yaml` if you want live demos.
3. Copy the logo assets the `brand:` block references into the deck's own
   directory — brand paths are slide-relative so a deck stays a portable bundle.
4. Write the chapter markdown, then `validate`. The landing page picks it up
   automatically and now shows two cards.

## Full specification

This is a summary. The authoritative reference is `spec/slidedeck.md` in the
platform repo (`dockersamples/simspace`), alongside `spec/labspace.md` and
`spec/catalog.md`.
