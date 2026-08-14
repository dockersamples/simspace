# @dockersamples/simspace-labspace

The Labspace **lab runtime**, packaged so it can be embedded in a site that
isn't this one — starting with Docker Learn (`docs.docker.com/learn`), which
mounts it as a React island inside its own Astro page.

The runtime is everything between a `labspace.yaml` and a learner: the
instruction panel (with the whole markdown authoring surface — Run/Save buttons,
`$$variables$$`, OS-conditional content), the terminal pane with several
terminals over **one** shared simulator, the Settings/controls panel, and the CI
tab.

It is deliberately **not** the lab app. The catalog/landing view, the slide deck,
and the instructor dashboard stay in `app/src/`; so do routing, the page shell,
and navigation. A host supplies those.

## Use it

```jsx
import { Labspace } from "@dockersamples/simspace-labspace";

<div style={{ height: "78vh" }}>
  <Labspace
    labspaceUrl="/learn/simspaces/run-an-agent-safely/labspace.yaml"
    labKey="run-an-agent-safely"
    brand={{ logo: "/learn/docker.svg", eyebrow: "Lab" }}
  />
</div>;
```

That is the whole integration. No stylesheet to include, no font to serve, no
theme to wire, no provider to nest — see `app/embed.html` for a working host
page that provides none of those and still renders correctly.

**Sizing is the one thing a host must get right.** The runtime fills its
container with `height: 100%`, and a percentage height needs a parent with a
definite height — including the element React mounts into. If the lab renders
at full content height and overflows, that missing rule is why.

**Typography is inherited on purpose.** The prose takes the host's font so the
lab reads as part of the page; code blocks and the terminal keep their own
monospace stack.

### Build-time loading (recommended for a static site)

Resolve the scenario in the page's frontmatter and pass the config, so the
instructions are in the served HTML and there is no loading state:

```js
import { loadLabspace } from "@dockersamples/simspace-labspace/loader";
const config = await loadLabspace(url, { fetchText: readFileFromDisk });
```

`/loader` pulls in no React — it's the entry a Node build wants.

### Props worth knowing

| Prop                          |                                                                       |
| ----------------------------- | --------------------------------------------------------------------- |
| `config` / `labspaceUrl`      | a resolved labspace, or one to fetch at mount                         |
| `labKey`                      | namespaces saved progress, variables, engine state, transcripts       |
| `brand`                       | `{ logo, eyebrow, backHref }`, or `false` for no header               |
| `menuItems`                   | extra actions in the header's context menu                            |
| `theme`                       | `"auto"` (default), `"light"`, `"dark"` — the terminal is always dark |
| `analytics`                   | where milestone events go; omitted → nothing leaves the page          |
| `section` / `onSectionChange` | drive the current section from the host's router                      |
| `components`                  | extra markdown directives                                             |

`LabspaceLayout` is the same thing without the workshop provider, for a host
that needs to read the loaded lab before the runtime mounts. The lab app uses
it; most hosts want `<Labspace>`.

## The boundary

Two rules keep this package embeddable, and both are easy to break by accident
because the lab app supplies globals that a host won't:

- **No host assumptions.** No router, no catalog, no service worker, no toast
  container, no globally-loaded Bootstrap, no `data-bs-theme` on `<html>`, no
  app-served font or logo at an absolute path. The lab app happens to provide
  every one of those, so **"the app still works" does not prove the package is
  embeddable.** `app/embed.html` is the check that does — it is built by
  `npm run build`, so a change that breaks embedding fails there rather than in
  a host that finds out later.
- **The dependency runs one way.** This package never imports from `app/src/`.
  Where the runtime needs something the app owns, the app **injects** it:
  `loadLabspace(url, { parseSlides })` because decks are the app's feature;
  `analytics` because pulse is the app's backend; `menuItems` because the
  service worker is the app's; `wrapTerminal` because the pop-out window is.

The same rule the simulator package follows, for the same reason.

## Layers below this one

This package sits on `@dockersamples/simspace-simulator` — the deterministic
engine and `<MockTerminal>`. That package knows nothing about labs, sections,
steps, or progress; this one supplies all of that vocabulary.
