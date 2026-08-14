# Embedding the Labspace runtime in Docker Learn

Handoff notes for whoever builds the lab page in `docker/learn`. Written by the
agent that extracted the runtime, so it leads with the things that cost time —
several of them contradict the integration proposal, which was written before the
code existed.

**Read §3 before you write the page.** Two of those four items decide the shape
of your Astro page, and both are cheap to get right up front and expensive to
retrofit.

---

## 1. What you're embedding

`@dockersamples/simspace-labspace` — the lab runtime, lifted out of the Labspace
app so a site that isn't that app can host a lab. It renders:

- the instruction panel (all markdown directives — Run/Save buttons,
  `$$variables$$`, OS-conditional blocks, file links, mermaid)
- the terminal pane: several terminals over **one** shared simulator, plus the
  CI tab and the Settings/controls panel when the lab declares them
- progress against the author's `steps:`, with local check-marks and resume

It does **not** bring routing, a page shell, navigation, a catalog, or a slide
deck. Those are yours (and the deck is deliberately out of scope).

Two entry points:

|                                           |                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@dockersamples/simspace-labspace`        | `<Labspace>` and the runtime. Pulls in React.                                                                    |
| `@dockersamples/simspace-labspace/loader` | `loadLabspace`, progress, slug/variable helpers. **No React** — this is the one you import in Astro frontmatter. |

---

## 2. The smallest thing that works

```astro
---
// src/pages/learn/simspaces/[scenario].astro
import { loadLabspace } from "@dockersamples/simspace-labspace/loader";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { scenario } = Astro.params;
const dir = new URL(`../../../content/simspaces/${scenario}/`, import.meta.url);

// The loader takes an injected reader, so the same parse the browser uses runs
// at build time against the filesystem. `fetchText` receives a file:// URL
// because every path in a labspace.yaml resolves against the labspace's own URL.
const config = await loadLabspace(new URL("labspace.yaml", dir).href, {
  fetchText: (url) => readFile(fileURLToPath(url), "utf8"),
});
---

<BaseLayout title={config.title} description={config.subtitle}>
  <h1>{config.title}</h1>
  <p>{config.subtitle}</p>

  <!-- The host sizes the lab. See §3.1 — the height rule is not optional. -->
  <div class="lab-frame">
    <Labspace
      client:only="react"
      config={config}
      labKey={scenario}
      brand={{ logo: "/learn/docker.svg", eyebrow: "Lab" }}
    />
  </div>
</BaseLayout>

<style>
  .lab-frame { height: 78vh; min-height: 520px; }
  /* Astro wraps an island in <astro-island>, which is display:contents by
     default — but anything you put between the sized box and the component
     needs a height too. */
  .lab-frame :global(astro-island) { display: block; height: 100%; }
</style>
```

There is a working reference implementation in this repo: **`app/embed.html`**
mounts `<Labspace>` on a page that deliberately provides no Bootstrap, no
router, no toast container, no app stylesheet and a different font. Run
`npm run dev` in `app/` and open `/embed.html`. If you hit something that page
doesn't, that's a package bug — report it rather than working around it.

---

## 3. The four that will cost you a day

### 3.1 The mount element needs a real height

The runtime sizes itself with `height: 100%`. A percentage height needs a parent
with a **definite** height, and that applies to _every_ element between your
sized box and the component — including whatever Astro puts around the island.

Miss it and the lab renders at full content height and overflows or gets
clipped. It looks like a layout bug in the runtime. It isn't.

### 3.2 Use `client:only="react"`, not `client:load`

`client:load` **will break your build.** Astro server-renders islands during the
static build; on the server, `rehype-mermaid` resolves to `mermaid-isomorphic`,
which requires **`playwright`**. It isn't a dependency of this package and
shouldn't be, so the Node import fails outright:

```
Cannot find package 'playwright' imported from .../mermaid-isomorphic/dist/mermaid-isomorphic.js
```

`client:only="react"` never imports the component in Node, so the problem
doesn't arise. Verified both ways.

### 3.3 The instructions will NOT be in your server-rendered HTML

This corrects the integration proposal, which recommended build-time loading
partly for "pre-rendering the instruction HTML" and SEO. It doesn't do that, for
a reason that has nothing to do with when the config is loaded:

the runtime renders markdown with react-markdown's **`MarkdownHooks`**, which
builds its tree inside a `useEffect`. Effects don't run during a server render,
so the markdown body is empty in the server pass no matter what you do. (It's
`MarkdownHooks` rather than the sync `Markdown` because `rehype-mermaid` is an
async plugin.)

Measured, with mermaid stubbed so a server render could complete at all: the
shell and terminal render (~2.9 KB of HTML), the instruction text does not.

**Build-time `config` is still the right choice** — no fetch waterfall, no
loading flash, no CORS surface, and the scenario is versioned with the page that
renders it. Just don't expect SEO from it.

If instruction text needs to be indexable, render it yourself into the page: you
already have the parsed config in frontmatter, and `config.sections[].contentRaw`
is the raw markdown. Run it through Astro's own markdown pipeline into a
`<noscript>` or a visually-hidden block.

### 3.4 Budget for the JavaScript

Measured by building a bare Vite project whose only entry is `<Labspace>`:

|                                      | total emitted assets                                        |
| ------------------------------------ | ----------------------------------------------------------- |
| `/loader` entry alone (no React)     | **104 KB**                                                  |
| full `<Labspace>` island             | **6.1 MB** (3.1 MB eager, 760 KB gzipped, rest lazy chunks) |
| └ of which `rehype-mermaid`          | **3.5 MB**                                                  |
| └ `react-syntax-highlighter` (Prism) | 640 KB                                                      |
| └ react-markdown + remark/rehype     | 336 KB                                                      |

**Mermaid is ~58% of it** and is only needed if a lab's markdown contains a
` ```mermaid ` fence. It is currently a static import inside the renderer, so
you cannot tree-shake it away from your side.

If this matters for a docs page — and on `docs.docker.com` it probably does —
ask the Labspace team to make mermaid optional or dynamically imported. That one
change roughly halves the payload and would also remove the `client:load`
blocker in §3.2. **Don't build a workaround for this yourself.**

Also note the icon font: **299 KB**, loaded by the runtime's own `@font-face`.
It's an instanced build of Material Symbols — already 92% off the upstream
3.5 MB, and it can't be subsetted further without constraining what `icon:`
values authors may write. See
`app/packages/labspace/scripts/instance-icon-font.mjs`.

---

## 4. Props

```jsx
<Labspace
  config={resolved} // or labspaceUrl="…/labspace.yaml"
  labKey="run-an-agent-safely" // REQUIRED in practice — see §5.1
  brand={{ logo, eyebrow, backHref }} // or false for no header
  menuItems={[]} // extra actions in the header's context menu
  theme="auto" // "auto" | "light" | "dark" — see §5.2
  analytics={adapter} // omit → nothing leaves the page
  section={id} // optional: drive the section from your router
  onSectionChange={fn}
  components={{}} // extra markdown directives
  onError={fn}
  defaultSplit={50} // instructions width, %
  autoSaveId="…" // persist the reader's split position
/>
```

`LabspaceLayout` is the same component without the workshop provider, for a host
that must read the loaded lab before the runtime mounts. You almost certainly
want `<Labspace>`.

---

## 5. Smaller things worth knowing

### 5.1 `labKey` namespaces everything persistent

Progress, variables, the engine snapshot, and terminal transcripts are all stored
under it. Two scenarios sharing a `labKey` will read each other's state. Use the
scenario slug.

Bumping `version:` in a `labspace.yaml` invalidates stored progress for that lab
while keeping the learner's identity — that's the supported way to say "the steps
changed".

### 5.2 Theming: it follows the reader's OS unless you tell it otherwise

Default is `prefers-color-scheme`. If Learn's theme switch is an explicit
toggle that doesn't track the system setting, the lab will disagree with the
rest of the page for anyone who has flipped it. Wire `theme={…}` to your toggle.

The **terminal pane is always dark** by design and ignores `theme`.

Prose **inherits your page font** on purpose, so the lab reads as part of the
page. Code blocks and the terminal keep their own monospace stack.

### 5.3 Analytics is silent by default

Omit `analytics` and the runtime makes zero network calls and starts no timers —
there's a test pinning exactly that. Local progress still works; it is not part
of the optional layer.

To wire it up, pass `{ track(event, payload) }`. Events: `lab_started`,
`section_viewed`, `step_completed`, `lab_completed`, `reset`, plus `heartbeat` /
`leave` **only if** your adapter sets `heartbeatMs`. Live presence is optional
via `subscribePresence(cb)`. `app/src/labspace/pulseAnalytics.js` is a complete
worked example.

### 5.4 `kind: slides` throws, deliberately

Slide decks are out of scope. A deck labspace.yaml raises a clear error rather
than rendering an empty deck. Don't pass `parseSlides`.

### 5.5 Scenario files

Keep each scenario's files in one directory. Everything a `labspace.yaml` names
(`simulator:`, `contentPath`, images, `files:`) resolves **relative to the
labspace.yaml itself**, so a scenario directory is portable and a subpath deploy
like `/learn/` needs no changes. Authors write paths exactly as they do today.

Validate scenarios in CI with this repo's `npm run validate-lab` — it checks
dangling `contentPath` / `simulator` / `terminal-id` references, `{{ args.X }}`
placeholders with no capture, and Run-button commands nothing handles. Authors
should use the existing `simspace-authoring-kit`.

### 5.6 React

React is a peer dependency, `>=18`; the Labspace app runs React 19. The package
ships **`.jsx` source**, not a compiled bundle, so your build must handle JSX in
`node_modules` — `@astrojs/react` does. There is no `.d.ts`; if you want types,
ask for the lib build.

---

## 6. Checklist

- [ ] Link the package (workspace/`file:` link is fine — it's the same team; npm publish is not a prerequisite)
- [ ] Scenario directories under `src/content/simspaces/<scenario>/`
- [ ] Load the config in frontmatter via `/loader` with an injected `fetchText`
- [ ] Mount with **`client:only="react"`**
- [ ] Give the mount element and every wrapper a definite height
- [ ] Pass a unique `labKey`
- [ ] Decide on `theme` if Learn's toggle doesn't follow the system
- [ ] Check the JS budget, and raise the mermaid question early
- [ ] Wire `validate-lab` into CI
- [ ] Compare against `app/embed.html` if anything looks wrong

## 7. Questions to send back

1. **Mermaid**: can it be made optional/dynamic? Biggest single win (§3.4), and
   it unblocks `client:load`.
2. **Lib build**: ESM + `.d.ts` + compiled CSS, if consuming source is awkward.
3. **Analytics backend**: pulse or Learn-native? The seam is ready; the choice
   isn't made, and nothing is blocked by leaving it open.
