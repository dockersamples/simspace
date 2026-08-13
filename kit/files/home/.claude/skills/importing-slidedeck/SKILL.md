---
name: importing-slidedeck
description: Import an existing presentation (Google Slides, PowerPoint, Keynote, a PDF export, reveal.js/Slidev markdown) into a Simspace deck (`kind: slides`). Use whenever asked to convert, port, migrate, or bring over a deck from another tool. Reconstructs each slide's layout as native markdown rather than embedding screenshots.
---

# Importing an existing deck

You are converting somebody's deck into a Simspace deck. The output is the same
thing the **authoring-slidedeck** skill produces — read that skill for the
layouts, components, and config keys; this one is only about getting from *their*
file to *those* primitives faithfully.

## The rule

**Rebuild the slide. Never photograph it.**

Screenshotting each source slide and emitting `![](slide-07.png)` is the failure
mode this skill exists to prevent. It looks like it worked and it is worthless:
the text isn't selectable, searchable, translatable, or responsive; it doesn't
reflow on a phone or a projector; the theme can't touch it; a typo costs an image
edit; and every slide is a 400KB PNG in the repo. A Simspace slide is a fluid
16:9 canvas whose type scales with the display — an image of a slide throws all of
that away and pins the deck to whatever resolution you captured.

So: read the source's **structure**, decide what each slide *is*, and express that
in the deck's own primitives. Images are for content that is genuinely an image
(§7), never for content that is merely *on* an image.

## The loop

1. **Get the source file** (§1) — a PDF export is a fine baseline; `.pptx` is
   richer if it's already to hand.
2. **Inventory it** (§2) — one command, gives you geometry, text, and layout hints.
3. **Write the plan** (§3) — slide-by-slide, before you write any markdown.
4. **Map each slide** (§4–§6) — layout, then components, then chapters.
5. **Validate and look at it** (§8), then write the import report (§9).

Don't skip step 3. Deciding all the layouts in one pass keeps the deck coherent;
deciding them one slide at a time gives you seven `default` slides and a `split`.

## 1. Getting a source file

**A PDF export is the baseline and it works.** Google Slides is the common case
here, and `File → Download → PDF Document` is the one click everybody already
knows. Don't block on getting anything better.

| Source | Export | Tool |
| --- | --- | --- |
| Google Slides | **File → Download → PDF Document** | `pdf-inventory.py` |
| Google Slides, if notes matter | **File → Download → PowerPoint (.pptx)** | `pptx-inventory.py` |
| PowerPoint / Keynote | Already `.pptx`, or **Export To → PowerPoint** | `pptx-inventory.py` |
| Anything, as PDF | Print/Export to PDF | `pdf-inventory.py` |
| reveal.js / Slidev / Marp / Deckset | Already markdown | skip to §4 — a mapping job |

Both tools read real structure and print the **same digest format**, so
everything from §3 onwards is identical whichever you ran.

What a PDF gives up, and what to do about it:

| | `.pptx` | PDF |
| --- | --- | --- |
| Text, font sizes, geometry | ✅ | ✅ |
| Images at original resolution | ✅ | ✅ |
| Columns, cards, tables | ✅ | ✅ (inferred from position) |
| Placeholder roles + layout names ("Two Content") | ✅ | ❌ inferred |
| **Speaker notes** | ✅ | ❌ **gone** |
| Animation builds → `:::fragment` | ✅ | ❌ |

The one that actually costs you is **speaker notes** — they're the highest-value
thing in an import and a normal PDF export drops them. So:

- If the deck has notes worth keeping, ask for the `.pptx` too. It's one extra
  download and you can run both tools over the same deck.
- Or export **File → Print settings and preview → 1 slide with notes → PDF**. The
  pages come out portrait with the notes beneath each slide, and `pdf-inventory.py`
  detects that automatically and reads the lower block as `Note:` text.
- If neither is available, say so in the report (§9) rather than inventing notes.

## 2. Inventory

```bash
# a PDF export (Google Slides and friends)
python3 ~/.claude/skills/importing-slidedeck/scripts/pdf-inventory.py deck.pdf \
  -o /tmp/inventory.json \
  --media labs/<deck-id>/assets/

# a .pptx — same flags, same digest, plus notes and layout names
python3 ~/.claude/skills/importing-slidedeck/scripts/pptx-inventory.py deck.pptx \
  -o /tmp/inventory.json \
  --media labs/<deck-id>/assets/
```

Stdlib Python only — nothing to install, no poppler, no pip. Both print a digest
to read directly and write the full detail as JSON if you need to go back for it.
`pdf-inventory.py` also takes `--pages 1-10,14` when you want to work through a
long deck in batches.

```
## Slide 2  ·  pptx layout "Two Content"  ·  2 build steps
    TITLE      x0.069 y0.053 w0.863 h0.193 40pt
               · Where developer time actually goes [40pt]
    BODY       x0.069 y0.266 w0.412 h0.634 20pt
               • Waiting on builds [20pt]
               • Reproducing a bug locally [20pt]
    BODY       x0.519 y0.266 w0.412 h0.634 20pt
               • Layer caching [20pt]
    PICTURE    x0.861 y0.044 w0.098 h0.058 ppt/media/logo.png [repeats on 3 slides]
    NOTES      Leave this up while you explain. Three rows is the point.
    -> suggested layout: split
```

The same slide out of a PDF — no placeholder roles or notes, but the structure
that decides the layout is all there:

```
## Slide 3
    TEXT       x0.045 y0.094 w0.479 h0.056 24pt
               · What's changing, what's decided, what's open [24pt]
    PICTURE    x0.039 y0.359 w0.452 h0.516 image-40adb3db.jpg
    PICTURE    x0.509 y0.359 w0.452 h0.516 image-40adb3db.jpg
    TEXT       x0.086 y0.399 w0.367 h0.181 12.5pt
               · APPROVED [12.5pt]
                 · The theme: the premise and the tagline. [12.5pt]
    TEXT       x0.556 y0.399 w0.319 h0.181 12.5pt
               · STILL OPEN [12.5pt]
                 · Keynote title: command recommended, final call pending. [12.5pt]
    -> suggested layout: split
```

Geometry is a **fraction of the slide**, so `x0.519 w0.412` means "starts just
past the midpoint, takes 41% of the width" — a right-hand column, at any aspect
ratio. Read the numbers; they're how you tell two columns from a shape that
happens to sit low. Font sizes are normalised to a 960pt-wide reference page in
both tools, so "40pt is a headline" means the same thing either way.

Two things to know when reading a **PDF** digest specifically:

- **The first line of a block is often its heading.** With no placeholder roles,
  a card's label and its body arrive as one block — `APPROVED` above its bullets.
  Split them yourself; the point size usually tells you where.
- **A repeated `PICTURE` behind text is furniture, not content.** Two identical
  images at `x0.039` and `x0.509` spanning the columns are the panel backgrounds
  a designer drew. They become `:::card`, not `![]()`.

`-> suggested layout:` is a first guess from geometry (and, for a `.pptx`, the
PowerPoint layout name). It's advisory, and it's weaker on a PDF where there are
no roles to read. You have the text; the tool doesn't know what the slide *means*.

## 3. The plan

Before writing markdown, produce a table covering **every** slide — show it to the
user and get agreement on anything marked as a judgement call:

| # | Source | → Layout | Components | Notes |
| - | ------ | -------- | ---------- | ----- |
| 1 | Title Slide | `title` | byline from subtitle | |
| 2 | Two Content | `split` (3 regions) | heading spans, 2 lists | 2 builds → fragments |
| 4 | Title Only, 3 round boxes | `stats` | 3 × `:::stat` | |
| 6 | Blank, big quoted text | `quote` | | attribution was 18pt bold |
| 7 | Title Only, full-bleed png | `default` | image kept | product screenshot — genuinely an image |
| 9 | Blank, logo only | **dropped** | | decorative interstitial |

This is also where deck-wide decisions get made once: chapter boundaries (§6),
the `brand:` block (§7), and whether the deck gets live demos (§8).

## 4. Choosing a layout

Read the geometry, not the source tool's label — a deck's author often reached for
"Title Only" and drew the real structure by hand.

| What the inventory shows | Layout |
| --- | --- |
| Slide 1; `ctrTitle` + `subTitle`; type ≥ 44pt, vertically centred | `title` |
| pptx layout "Section Header"; a title low/centred, ≤ 1 supporting line, no body | `section` |
| Two-plus text shapes at similar `y`, each `w` ≈ 0.4, different `x` | `split` |
| Same, **plus** a full-width shape above them (`w` > 0.7) | `split`, heading + `<!-- region -->` |
| Same, but the columns are clearly **unequal** widths | `split` + `columns:` — see below |
| One picture covering most of the slide, text over or beside it | `image` |
| 2–4 short shapes each led by a big number (≥ 40pt, digits) | `stats` |
| One large text block in quote marks + a smaller attribution beneath | `quote` |
| A title and one body — bullets, prose, code, one image | `default` |

Reading a PDF, where there are no roles, lean on these instead:

- **One headline far larger than anything else** (roughly ≥ 1.7×) with little
  else on the page is a `title` or a `section`. Which one is a judgement call:
  near the front of the deck, or carrying a date/venue line, it's the opener;
  mid-deck with a single supporting line, it's a divider.
- **A quote slide's quotation is the biggest text on the slide.** Body copy that
  merely contains a quoted phrase is not a `quote` slide — this is the easiest
  mistake to make from a PDF, and the tool guards against it.
- **The same two columns repeating down the page** (label left, description
  right, four times over) is a row list, not a two-column split. Use `default`
  with a table or a stack of `:::card`s.

Then the conventions each layout carries (see **authoring-slidedeck**): a `title`'s
subtitle becomes the standfirst paragraph and its footer line becomes `byline:`; a
`section`'s supporting line is the paragraph after the heading; `quote` generates
its own quote mark, so strip the source's typographic quotes from the text.

**The `split` region rule bites here.** Two regions are two columns. Three or more
make the first a full-width header band. So a source slide with a heading spanning
above two columns needs *three* regions — heading, left, right — not a heading
followed by two.

**Carry the column ratio across.** The digest gives you each column's `w`, so use
it: a `w0.23` label column beside a `w0.45` description column is `columns: 1 2`,
not two equal halves. Round to small whole numbers — the design intent is "one
narrow, one wide", not 23:45. Leave `columns:` off when the source columns are
within a few percent of each other; equal is the default for a reason.

## 5. Mapping shapes to components

Once the layout is chosen, each shape becomes markdown:

| Shape in the source | Becomes |
| --- | --- |
| Title placeholder — or, in a PDF, the largest text near the top | `#` heading (`##` if the slide already has a `#`) |
| Bulleted body, one level | a `-` list |
| Bulleted body, indented levels | a nested `-` list — `level` in the digest is the indent |
| Short text in a filled or outlined round-rect | `:::card{label=… accent=…}` |
| Big number + caption | `:::stat{value="20B+"}` + the caption as the body |
| One or two words in a small pill, beside another block | `:tag[Before]{accent=red}` |
| Monospace text block (digest says `mono`) | a fenced code block, `filename=` for its header |
| A `table` frame | a GFM table — the digest prints the cells |
| Boxes joined by connectors, or SmartArt | a `mermaid` fence (§7) |
| Field text — slide number, date, footer | **drop it**; the deck chrome does this |
| Repeating logo (`[repeats on N slides]`) | **drop it**; becomes `brand.logo` once (§7) |

Two more mappings that carry real authoring value across:

- **Speaker notes → `Note:`.** Copy them verbatim to the end of the slide. This is
  the highest-value, lowest-effort part of the import and it is routinely
  forgotten. Notes are what the deck's author actually planned to *say*. A plain
  PDF export doesn't carry them — see §1 for the two ways to get them anyway.
- **Build steps → `:::fragment`.** `N build steps` in the digest means the author
  revealed the slide in N clicks. Wrap the revealed blocks in `:::fragment`, in
  document order. If you can't tell which blocks were animated, ask rather than
  guessing — a wrong fragment breaks a talk's timing. A PDF has no builds at all,
  so don't invent them; a deck can be imported without a single fragment.

**Accents carry meaning, so map the intent, not the hex.** A red box in the source
is `accent=red` because red meant "before/bad", not because `#E5484D` is the
nearest match. Where the source used its own brand colour for everything, use the
default `blue` and say so in the report.

## 6. Splitting into chapters

A source deck is one flat list; a Simspace deck is one markdown file per chapter,
registered under `slides:`. Split on the source's own section-divider slides — the
ones that became `layout: section`. Each divider opens the chapter it announces.

```
labs/<deck-id>/
  labspace.yaml       # kind: slides, brand:, slides: […]
  00-opening.md       # title slide + framing
  01-why-containers.md
  02-building-images.md
  assets/             # extracted media + logos
```

Name files `NN-<slug>.md` after the divider's title, and give each entry a `title:`
in `slides:` — the chapter title is what slide ids are derived from, and it's what
the presenter window shows.

If the deck has no dividers, chapter it by topic at roughly 8–15 slides. One
80-slide file is technically fine and miserable to edit.

## 7. Assets, brand, and the images you *do* keep

`--media` extracts every embedded image, deduplicated by content. The `.pptx`
tool also reports how many slides each appears on; from a PDF, judge by how often
the same extracted file shows up across the digest.

- **Used on many slides → it's chrome.** A logo on 24 of 30 slides is the deck's
  brand mark. Put it in `brand.logo` in `labspace.yaml` once and drop it from every
  slide. Keep both variants if the source had them — **a dark slide needs the white
  mark**, and this is the most common thing to get wrong.
- **Used many times *within* a slide, behind text → it's a panel.** A designer's
  card background repeated per column. That's `:::card`, not an image.
- **Used once → it's content.** Decide what it actually is:

| The image is | Do |
| --- | --- |
| The whole slide — a photo the words sit on top of | `layout: image` with `image:` and `alt:`. Drop the source's own text box; the layout draws the panel. |
| A photo, product screenshot, or chart you can't reproduce | Keep it. `![alt](assets/x.png)` resolves relative to the chapter file. Write real alt text. |
| A diagram of boxes and arrows | Rebuild as a `mermaid` fence — it themes, scales, and stays editable. |
| A screenshot **of text** (a terminal, a code sample, a config file) | Rebuild as a code fence. This is the single biggest fidelity win in most imports. |
| A screenshot of a command being run | Consider a live `::terminal` demo instead (§8). |
| A gradient, swoosh, or divider | Drop it. The theme has its own. |

Always keep the extracted original rather than re-capturing a rendered slide: it's
the highest resolution that ever existed, and it has no slide furniture baked in.

## 8. Finish

```bash
docker compose run --rm validate    # must be green
docker compose up dev               # then look at it — http://localhost:5173
```

**Looking at it is not optional on an import.** Validation can't see that a
migrated slide has twice the text the layout wants — and it usually does, because
a slide designed at 24pt in a fixed canvas is being re-set in a scale where body
copy is `1.45cqi`. Open the deck, step through with `→`, and fix the overfull
ones by cutting words, promoting content to a second slide, or moving detail into
`Note:` where it belongs. Press `p` for present mode when you want the slide and
nothing else on screen.

Spot-check fidelity on the slides you flagged as judgement calls in §3 — open the
source alongside the import rather than trusting the digest. You don't need to
compare all thirty.

If the source deck's demos were screenshots of a terminal, that's the moment to
point `simulator:` at the sibling lab's `simulator.yaml` and replace them with a
real `::terminal`. It's the reason to be in this format at all — but propose it,
don't do it unasked; it changes the talk.

## 9. The import report

End by telling the user what you decided for them. Nothing else in the process
surfaces this, and every import has some:

- Slides **dropped**, and why (decorative, duplicated, build-up frames).
- Slides **merged or split** relative to the source numbering.
- Content moved from the slide into `Note:`.
- Images **kept as images**, with the reason each one couldn't be rebuilt.
- Anything you **couldn't map** and approximated — an unusual layout, a colour
  system, a font the theme doesn't carry.
- The source's slide count vs the deck's, so nothing goes missing quietly.

## 10. When there's no text to read

Both tools warn when a source yields no text. It means one of:

- **A PDF of images** — someone exported slides as pictures and wrapped them, or
  scanned them. There is no text layer to recover.
- **A deck built entirely in outlined vector art**, where the type has been
  converted to paths.
- **Screenshots or an image export** handed over instead of a deck.

Ask for a real export once. If there genuinely isn't one, reading the rendered
slides to *work out their structure* and rebuilding that structure in markdown is
legitimate — it's the last honest option, and it still beats the alternative.
Reading them and emitting `![](slide-07.png)` is not, and is the whole reason
this skill exists. Expect to ask more questions, and expect the report in §9 to
be longer.

## Gotchas

- **`---` splits slides.** Source text containing a horizontal rule must become
  `----` (four dashes) or it silently becomes a slide break.
- **A `---` on line 1 of a chapter file is YAML front matter**, not a slide break.
  A chapter starting with a config-less slide is fine; just don't lead with `---`.
- **Imported code is a sample, not a command — and a slide already knows that.**
  Deck fences get no Run button unless they carry `terminal-id=`, so paste the
  code and move on. Don't add `no-run-button` (that's a lab habit), and don't add
  `terminal-id=` to a block you aren't actually wiring to a `::terminal`.
- **Hidden slides** (`HIDDEN` in the digest) were hidden on purpose. Drop them
  unless the user asks otherwise, and list them in the report.
- **Set `version:`** in `labspace.yaml` from the start, and bump it whenever you
  add or remove a slide afterwards — ids are positional.
- **Copy brand assets into the deck's own directory.** Paths are entry-relative;
  a deck should stay a portable bundle.
- **Smart quotes, en dashes, and non-breaking spaces** come across from the source.
  Keep them — they're the author's typography — but check that a `“` at the start of
  a `quote` slide isn't doubling the generated quote mark.
- **Don't run a markdown formatter over `labs/`.** Prettier rewrites `***` and
  `___` to `---`, which splits slides.
