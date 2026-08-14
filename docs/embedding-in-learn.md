# Embedding the Labspace runtime in Docker Learn

Handoff notes for whoever builds the lab page in `docker/learn`. Written by the
agent that extracted the runtime, so it leads with the things that cost time —
several of them contradict the integration proposal, which was written before the
code existed.

**Read §3 before you write the page.** Those items decide the shape of your
Astro page, and they are cheap to get right up front and expensive to retrofit.

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

|                                               |                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@dockersamples/simspace-labspace`            | `<Labspace>` and the runtime. Pulls in React.                                                                    |
| `@dockersamples/simspace-labspace/loader`     | `loadLabspace`, progress, slug/variable helpers. **No React** — this is the one you import in Astro frontmatter. |
| `@dockersamples/simspace-labspace/styles.css` | Every style the runtime needs, in one file. Import it once.                                                      |

---

## 2. The smallest thing that works

Install the two packages, then:

```js
// astro.config.mjs — this is the whole integration.
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({ integrations: [react()] });
```

No `vite.ssr.noExternal`. No `vite.optimizeDeps.include`. The packages ship
compiled ESM with a CSS bundle, so Vite treats them like any other dependency.
(An earlier revision shipped `.jsx`/`.scss` source and did need both — if you find
a guide or a config that mentions them, it predates the build.)

```astro
---
// src/pages/learn/simspaces/[scenario].astro
import { loadLabspace } from "@dockersamples/simspace-labspace/loader";
import { Labspace } from "@dockersamples/simspace-labspace";
import "@dockersamples/simspace-labspace/styles.css";

// Every scenario file, inlined at build time. Preferred over reading from disk:
// it behaves the same in `astro dev` and `astro build`, and doesn't depend on
// `import.meta.url` (which points into dist/ after the build) or on the cwd.
const files = import.meta.glob("../../../content/simspaces/**/*.{yaml,md}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const { scenario } = Astro.params;
// A base for the loader to resolve relative paths against. It is never fetched —
// `fetchText` intercepts every read — but it does become `config.baseUrl`, which
// is what relative image paths in the markdown resolve against. So use the URL
// the scenario's assets will really be served from.
const base = `https://docs.docker.com/learn/simspaces/${scenario}/`;
const config = await loadLabspace(`${base}labspace.yaml`, {
  fetchText: async (url) => {
    const key = `../../../content/simspaces/${scenario}/${url.slice(base.length)}`;
    if (!(key in files)) throw new Error(`Not in the scenario: ${url}`);
    return files[key];
  },
});
---

<BaseLayout title={config.title} description={config.subtitle}>
  <h1>{config.title}</h1>

  <!-- The host sizes the lab. See §3.1 — the height rule is not optional. -->
  <div class="lab-frame">
    <Labspace
      client:load
      config={config}
      labKey={scenario}
      brand={{ logo: "/learn/docker.svg", eyebrow: "Lab" }}
    />
  </div>
</BaseLayout>

<style>
  .lab-frame { height: 78vh; min-height: 520px; }
  /* Astro wraps an island in <astro-island>, which is display:contents — but
     anything between the sized box and the component needs a height too. */
  .lab-frame :global(astro-island) { display: block; height: 100%; }
</style>
```

**Import `styles.css` once**, in the page or a shared layout. The compiled
modules deliberately do not import their own CSS: a server render loads the
package through Node, and Node cannot load a `.css` file — that is precisely what
makes `ssr.noExternal` necessary for libraries that do it the other way.

That example is real. It was built and driven in a browser against a stock Astro
5 project: instructions render, styles and the icon font apply, a mermaid diagram
draws, and clicking Run streams output into the terminal and ticks the milestone.

There is a second reference in this repo: **`app/embed.html`** mounts
`<Labspace>` on a page with no Bootstrap, no router, no toast container and a
different font. `npm run dev` in `app/`, then open `/embed.html`. If you hit
something neither reference does, that's a package bug — report it rather than
working around it.

---

## 3. The ones that will cost you a day

### 3.1 The mount element needs a real height

The runtime sizes itself with `height: 100%`. A percentage height needs a parent
with a **definite** height, and that applies to _every_ element between your
sized box and the component — including whatever Astro puts around the island.

Miss it and the lab renders at full content height and overflows or gets
clipped. It looks like a layout bug in the runtime. It isn't.

### 3.2 `client:load` works — and either directive is fine

This used to be a hard blocker and no longer is. Mermaid is loaded from inside an
effect now, so a server render never evaluates it. Pinned by a test
(`Labspace.ssr.test.jsx`) that server-renders a lab **containing** a diagram.

With a build-time `config`, the server pass emits the panel shell and the
terminal (~2.9 KB of HTML), so `client:load` gives a real first paint rather than
a spinner. `client:only="react"` remains perfectly valid and marginally simpler.

For the record, since it is the kind of thing that gets reintroduced: while
`rehype-mermaid` was a static import, importing the renderer under Node pulled
`mermaid-isomorphic`, which resolves to a **playwright**-backed build there. Any
server render failed with `Cannot find package 'playwright'`. If that error comes
back, something made the mermaid plugin static again.

### 3.3 The instructions will NOT be in your server-rendered HTML

This corrects the integration proposal, which recommended build-time loading
partly for "pre-rendering the instruction HTML" and SEO. It doesn't do that, for
a reason that has nothing to do with when the config is loaded:

the runtime renders markdown with react-markdown's **`MarkdownHooks`**, which
builds its tree inside a `useEffect`. Effects don't run during a server render,
so the markdown body is empty in the server pass no matter what you do. (It's
`MarkdownHooks` rather than the sync `Markdown` because `rehype-mermaid` is an
async plugin.)

Measured: the shell and terminal render (~2.9 KB of HTML); the instruction text
does not.

**Build-time `config` is still the right choice** — no fetch waterfall, no
loading flash, no CORS surface, and the scenario is versioned with the page that
renders it. Just don't expect SEO from it.

If instruction text needs to be indexable, render it yourself into the page: you
already have the parsed config in frontmatter, and `config.sections[].contentRaw`
is the raw markdown. Run it through Astro's own markdown pipeline into a
`<noscript>` or a visually-hidden block.

### 3.4 Budget for the JavaScript

Measured by building a bare Vite project whose only entry is `<Labspace>`. What a
reader downloads to open a lab is the **eager** column:

|                                  | eager                        | total emitted |
| -------------------------------- | ---------------------------- | ------------- |
| `/loader` entry alone (no React) | 104 KB                       | 104 KB        |
| full `<Labspace>` island         | **2.2 MB** (~700 KB gzipped) | 6.1 MB        |

Mermaid — 3.5 MB, by far the heaviest thing here — is **not eager**. It loads on
demand, and only for a document that actually contains a ` ```mermaid ` fence, so
a lab with no diagram never fetches it at all.

Roughly what makes up the 2.2 MB:

|                                                        |         |
| ------------------------------------------------------ | ------- |
| react + react-dom                                      | 192 KB  |
| `react-syntax-highlighter` (Prism, all ~280 languages) | ~630 KB |
| react-markdown + remark/rehype/micromark/`rehype-raw`  | ~1.2 MB |
| the simulator engine + terminal                        | 16 KB   |

Note how cheap the _simulator_ is — the weight is all markdown machinery. The next
worthwhile lever is `react-syntax-highlighter`: moving to `PrismLight` with only
the languages labs actually use would recover most of that 630 KB. Ask for it if
your budget is tight rather than working around it on your side.

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

### 5.6 React and types

React is a peer dependency, `>=18`; the Labspace app runs React 19.

Both packages ship compiled ESM. `simspace-simulator` includes `.d.ts` files
(it's TypeScript); the runtime is plain JSX and ships none, so `<Labspace>` and
its props are untyped. Ask if you want them — the props are documented in §4 and
in the component's own doc comment meanwhile.

---

## 6. Checklist

- [ ] Install both packages (a `file:` tarball from `npm pack` is fine — same team, publishing is not a prerequisite)
- [ ] `import "@dockersamples/simspace-labspace/styles.css"` once, in the page or a layout
- [ ] Scenario directories under `src/content/simspaces/<scenario>/`
- [ ] Load the config in frontmatter via `/loader` with an injected `fetchText`
- [ ] Mount with `client:load` or `client:only="react"` (either works)
- [ ] Give the mount element and every wrapper a definite height
- [ ] Pass a unique `labKey`
- [ ] Decide on `theme` if Learn's toggle doesn't follow the system
- [ ] Check the JS budget (§3.4) against your page-weight targets
- [ ] Wire `validate-lab` into CI
- [ ] Compare against `app/embed.html` if anything looks wrong

## 7. Questions to send back

1. **`react-syntax-highlighter`**: move to `PrismLight` with a registered
   language list? ~630 KB of the remaining 2.2 MB (§3.4).
2. **Precompiled diagrams**: if diagram-heavy labs make the on-demand 3.5 MB
   fetch a problem, diagrams can be rendered to SVG at build time instead —
   inline `<svg>` in markdown already renders with no renderer changes. It costs
   a headless browser in the build and means diagrams can't contain
   `$$variables$$`, so it's worth doing only if measurement says so.
3. **Types for the runtime**: `.d.ts` for `<Labspace>` and its props, if the
   untyped surface gets in the way.
4. **Analytics backend**: pulse or Learn-native? The seam is ready; the choice
   isn't made, and nothing is blocked by leaving it open.
