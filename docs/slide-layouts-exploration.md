# Exploration: slide layouts

**Status:** Research / pre-decision. Nothing implemented.

Follows on from [`slidedeck-exploration.md`](slidedeck-exploration.md) and the
shipped `kind: slides` support. Sources: `references/screenshots/` (13 designed
slides) and `references/html-version/` (the Claude Design output that produced
them).

## 1. The headline

**Three separable features are bundled together in those screenshots**, and they
have very different costs. Naming them apart is the most useful thing this
document does, because it lets you ship the cheap two and defer the expensive one:

| Layer          | What it is                                                                                    | Effort                                      |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Layout**     | How a slide's regions are arranged — title, split, section divider, quote                     | **~1.5 days**                               |
| **Theme**      | Docker brand chrome: dark/tint surfaces, wave backgrounds, logo, eyebrow, footer, page number | **~1.5 days** (+ a font licensing question) |
| **Components** | Stat blocks, annotation cards, before/after tags, code-window chrome, numbered agenda rows    | **~2–4 days, open-ended**                   |

Layout is the small one. Most of what makes those screenshots look designed is
_theme and components_, not layout.

And there's a fourth question underneath all of it (§5): the reference is a
**fixed 1920×1080 canvas scaled with `transform`**, while our deck is fluid. That
choice is worth making deliberately, and I'd argue against copying it.

## 2. What the 13 screenshots actually contain

Categorised by what each one _needs_, not by what it looks like:

| #   | Slide                   | Layout    | Beyond layout                        |
| --- | ----------------------- | --------- | ------------------------------------ |
| 01  | Build. Ship. Run.       | `title`   | dark theme, byline                   |
| 02  | Agenda                  | default   | numbered-card component              |
| 03  | The numbers             | default   | **stat** component ×3                |
| 04  | Where dev time goes     | `split`   | ruled list styling                   |
| 05  | Containerize Everything | `section` | tint theme                           |
| 06  | Cache mounts            | default   | code-window chrome (filename + dots) |
| 07  | Before / After          | `split`   | **tag** component, code chrome       |
| 08  | Compose Watch           | `split`   | **note-card** component, dark theme  |
| 10  | Five lines to CI        | `split`   | **note-card** component              |
| 11  | Ship fast, ship secure  | `split`   | **feature-card** component           |
| 12  | Desktop vs Engine       | default   | table styling only                   |
| 13  | Quote                   | `quote`   | dark theme                           |
| 14  | Ready to ship?          | `split`   | **note-card** component, dark theme  |

**Six of thirteen are the same two-region `split`.** The distinct layouts reduce to
five: `title`, `section`, `split`, `quote`, and the existing default. That's a
genuinely small surface — which is why layout is the cheap layer.

Notice how the "Beyond layout" column is where the variety lives. Four card-ish
components (stat, tag, note-card, feature-card) cover eleven of the thirteen
slides, and they're all the same shape: an optional label, a body, an accent
colour. That's a hint the component layer could be **one** component with variants
rather than four (§4.3).

## 3. How it would be represented

### 3.1 Per-slide config: the thing we don't have yet

Slides currently carry no configuration channel at all. Options considered:

| Form                                              | Verdict                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| YAML front matter per slide (`---` fenced)        | **No** — `---` is already the slide separator; the ambiguity is nasty            |
| `Layout: split` magic line, mirroring `Note:`     | Workable and consistent with what exists, but puts config in the prose namespace |
| `:::slide{layout=split}` wrapping the whole slide | **No** — indents every slide's content, fights "markdown is markdown"            |
| Info string on the separator (`--- layout=split`) | Cute, but the first slide of a file has no preceding separator                   |
| **HTML comment** (reveal's convention)            | **Recommended**                                                                  |

Recommended: a **leading HTML comment holding YAML**. It's unambiguous, invisible
to any other markdown renderer, keeps config visually distinct from content, and
matches the `<!-- .slide: -->` convention reveal users already know — the same
portability argument that got us `Note:` and `---`.

```markdown
<!--
layout: title
theme: dark
eyebrow: Developer Platform · Design System Showcase
byline: Docker Engineering
source: Tech Talk · 2026
-->

# Build. Ship. Run.

A developer's guide to the Docker platform — from inner loop to production CI/CD.
```

Parsing is cheap: strip a leading `<!-- … -->` in `parseSlides` and hand the body
to the `yaml` dependency we already have. It happens _before_ rendering, so the
comment never reaches `rehype-raw` and can't leak into the DOM.

Deck-wide defaults belong in `labspace.yaml`, so authors set the brand once:

```yaml
kind: slides
theme: docker-dark # default for every slide; a slide may override
brand:
  eyebrow: "Docker Developer Platform"
  source: "docker.com · 2026"
  logo: assets/docker-logo-white.svg
```

### 3.2 Regions: one separator, because every layout needs only two

Since `split` is the only layout needing content assignment, this needs **one**
region marker, not a general region system.

> [!IMPORTANT]
> The obvious choice — markdown's other thematic-break form, `***` — **does not
> work in this repo.** Prettier normalizes `***` (and `___`) to `---`, and
> `npm run prettier` runs over `app/public/labs/**`. Every region break would be
> silently rewritten into a _slide_ break, shattering each split slide in two. I
> verified this before recommending it; it would have been a nasty thing to
> discover after the fact.
>
> HTML comments and `:::` directives both survive Prettier untouched.

So the region separator should be a comment too — which means **one mechanism,
HTML comments, serves both config and region breaks**:

```markdown
<!-- layout: split -->

# Where developer time actually goes

### The problem

Waiting minutes per build cycle compounds into hours lost daily

<!-- region -->

### The fix

Cache mounts and bind mounts eliminate redundant work
```

The heading stays above the split and spans both columns, which is exactly how
every one of the six `split` screenshots is built.

The alternative, if a comment reads too much like an escape hatch, is a
`:::region` container directive — also Prettier-safe, consistent with
`:::fragment`, but it indents and wraps each region's content.

### 3.3 The demo terminal drops straight in

`::terminal{}` needs no changes: inside a `split` region it just becomes the
region's content. That's the layout worth having for a demo slide — explanation on
the left, live terminal on the right — and it's free:

```markdown
<!-- layout: split -->

# Start a container

Ship the environment, not just the code.

<!-- region -->

::terminal{id=demo}
```

### 3.4 Components, if we build them

Container directives, consistent with the `:::fragment` precedent:

```markdown
<!-- layout: stats -->

# The numbers that define the modern dev workflow

:::stat{value="20B+"}
Docker Hub pulls per month across every language and stack
:::

:::stat{value="84%"}
of developers now use AI coding tools at least weekly
:::
```

````markdown
<!-- layout: split -->

# Compose Watch: hot reload without rebuilds

```yaml filename=compose.yaml highlight=4-11
services:
  api:
    build: .
    develop:
      watch:
        - action: sync
          path: ./src
```

<!-- region -->

:::card{label="sync action"}
Copies changed files into the running container without rebuilding the image.
:::

:::card{label="rebuild action" accent=green}
Triggers a full rebuild only when a dependency file changes.
:::
````

`filename=` on the fence is a ~5-line addition to `codeIndexer.js`, and gets the
code-window chrome (filename + traffic lights) that appears on five slides.
`CodeBlock` already renders a header with either the language or the `save-as`
path, so this extends an existing affordance rather than adding one.

## 4. Effort, honestly

### 4.1 Layout + config (~1.5 days)

| File                                    | Change                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `app/src/deck/splitSlides.js`           | strip + parse the config comment; split regions on `***`. ~40 lines                   |
| `app/src/deck/splitSlides.test.js`      | config parsing and region cases — the fence-aware scan already has coverage to extend |
| `app/src/context/DeckContext.jsx`       | carry `layout`, `theme`, `config`, `regions` through. ~10 lines                       |
| `app/src/components/Deck/DeckView.jsx`  | render regions, apply `deck-slide--<layout>`, render chrome from config. ~60 lines    |
| `app/src/components/Deck/DeckView.scss` | the five layouts. ~150 lines                                                          |
| `app/src/labspace/loader.js`            | deck-level `theme`/`brand` defaults. ~10 lines                                        |
| `app/scripts/validate-lab.ts`           | warn on an unknown `layout:` or `theme:` name. ~15 lines                              |

`title`, `section`, and `quote` are **pure CSS** on markdown we already render —
a blockquote is a blockquote. Only `split` needs the region plumbing.

### 4.2 Theme (~1.5 days, plus a licensing question)

`references/html-version/colors_and_type.css` and `slides/slides.css` are directly
liftable — they're the valuable part of that reference, and they're already
token-based (`--docker-ocean`, `--bg-2`, `--rule-1`), which is the same pattern
`DeckView.scss` and `WorkshopPanel.scss` already use. Mostly a port, not a design
exercise.

Two things that aren't just CSS:

- **Chrome as config.** The topbar (logo + eyebrow) and footer (source + page
  number) appear on every reference slide and are per-slide text. That's the
  `eyebrow:`/`source:` config from §3.1 plus deck-level defaults — small, but it's
  new rendering in `DeckView`, not a stylesheet.
- **Font licensing — check before committing.** The display face is **ABC Repro
  (Dinamo)**, a commercial font, and the reference bundles `.woff`/`.woff2` files.
  Self-hosting it in a _public_ static deploy redistributes it, which its licence
  may not permit. IBM Plex Sans (body) and JetBrains Mono are open-licensed and
  fine. Worth resolving with whoever owns the brand assets, because the fallback —
  Inter, which the app already ships — changes how close to the comps we can get.

### 4.3 Components (~2–4 days, and this is the open-ended part)

Four card shapes cover eleven slides, and they're structurally the same thing:
optional label, body, accent colour. I'd build **one `:::card` with variants**
(`stat`, `note`, `feature`, `tag`) rather than four components — otherwise this
layer grows a new component every time someone designs a slide, which is exactly
how a "layout feature" turns into a six-week design-system project.

Even so this is the item most likely to expand, and the one I'd cut first if the
goal is "a few different layout options."

### 4.4 Total

**~3 days** for layouts + theme with no new components — which already gets you
slides 01, 04, 05, 06, 12, 13 and a very good demo slide. **~1 week** including a
single variant-driven card component, which covers essentially all thirteen.

Nothing here is a breaking change: a slide with no config comment renders exactly
as it does today.

## 5. The fixed-canvas question

The reference is `<deck-stage width="1920" height="1080">` — a fixed canvas
letterboxed into the viewport with `transform: scale()`. Our deck is fluid
(`clamp()` + `vmin`, content-driven height). This is the one architectural
decision in here, and I'd **not** copy the reference.

**For fixed:** pixel-faithful to a designer's comp, entirely predictable, and the
reference's `@media print` trick (lay every slide out at design size → clean
one-page-per-slide PDF) would solve our missing PDF export almost for free.

**Against fixed, and why I'd decline:**

- **The demo terminal is our differentiator and `transform: scale()` degrades it.**
  Text renders blurry at non-integer scales, and caret position and text selection
  inside a transformed subtree are unreliable across browsers. Making the one thing
  no other deck tool has feel second-rate is a bad trade.
- **Overflow becomes a hard failure.** Screenshot 10 already demonstrates this — the
  code block runs off the bottom of the canvas and collides with the footer, _in
  the reference itself_. Our fluid slides scroll instead: less pretty, never
  broken.
- **`deck-stage.js` is not reusable anyway.** It's a complete competing deck
  runtime (2,969 lines: its own keyboard nav, notes, thumbnails, PPTX export). It
  wants to own navigation and the hash — the same conflict that ruled out
  reveal.js. Only its CSS is worth taking.

**The middle path I'd recommend:** keep a fluid layout but constrain the slide to a
**16:9 `aspect-ratio` box** and size type in **container query units** (`cqw`/`cqh`)
instead of `vmin`. Type then scales proportionally with the slide box exactly as it
would on a fixed canvas — so a designed layout holds its proportions — with no
transform, no blurry terminal, and overflow still able to scroll. That's most of
the fidelity for none of the cost, and it's a small change to the existing
`DeckView.scss`.

## 6. Decisions needed

1. **Scope.** Layouts + theme only (~3 days), or include a card component (~1 week)?
2. **Fixed canvas, or fluid with a 16:9 container-query box?** (§5 — I recommend
   the latter.)
3. **ABC Repro licensing** (§4.2). If we can't self-host it, agree the fallback
   before building the theme, because it affects every type scale in the port.
4. **Config syntax** — HTML comment (recommended), or a `Layout:` magic line
   consistent with the existing `Note:`?
5. **Region separator**: `<!-- region -->` (recommended — one mechanism with the
   config comment, and Prettier-safe) or a `:::region` directive? Note that the
   markdown-native options are ruled out, not merely disfavoured: Prettier rewrites
   `***` and `___` to `---`, which would turn region breaks into slide breaks (§3.2).
6. **Is the Docker brand theme the only theme**, or is this a themes _system_
   (author-selectable, overridable per deployment)? "A few layout options" implies
   the former; the `references/` design system implies someone may want the latter.

## 7. Deferred / open

- **A Prettier guard for lab content.** The `***`→`---` rewrite (§3.2) is one
  instance of a general hazard: Prettier reformats `app/public/labs/**`, and slide
  markdown now has load-bearing syntax it doesn't know about. Worth deciding
  whether lab content should be in `.prettierignore` entirely, or whether the
  syntax should simply stay inside forms Prettier provably leaves alone (comments
  and directives — which is what this proposal does).
- **Overflow detection.** Nothing can catch "this slide's content doesn't fit" at
  validate time, since it depends on the viewport. A dev-mode overlay that flags an
  overflowing region during authoring would be cheap and would prevent the class of
  bug visible in screenshot 10.
- **Table styling collision.** `MarkdownRenderer` maps `table` to Bootstrap's
  `table table-sm table-striped`, which is wrong for a deck (screenshot 12 wants a
  dark header band and generous rows). Needs a deck-scoped override, not a change
  to the shared renderer.
- **PDF export** stays unbuilt either way, but the fixed-canvas print trick is
  worth revisiting if a 16:9 aspect box lands.
- **Per-region layout hints** (column widths, vertical alignment) — the reference
  uses a plain `1fr 1fr` everywhere, so there's no evidence we need more yet.

```

```
