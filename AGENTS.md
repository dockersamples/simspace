# AGENTS.md

Agent-oriented guide to this repository. Read this first to load context quickly.

## What this is

A **static, server-free learning runtime**. Authors write a lab (instructional
markdown + a scenario spec); learners get a browser-based **mock terminal** that
responds to any command deterministically — no backend, no AI API keys, no
network, no real Docker. The whole thing is a React app that fetches its config at
startup and simulates every command in-browser, deployable to any static host.

Authors can also ship a **slide deck** (`kind: slides`) from the same repo, so the
slides and the hands-on lab for one workshop are a single build and a single
deploy. Decks are markdown too, and a slide can embed a live demo terminal driven
by the same simulator.

The simulator is a config-driven, in-memory **state machine**: each command the
learner types is matched against author-declared scenarios (first-match-wins)
and produces the same output, file changes, and state transitions every time.

## Specifications — read these before touching the engine or lab files

The YAML formats and catalog that drive everything are fully specified in `spec/`:

- **[`spec/simulator.md`](spec/simulator.md)** — the `simulator.yaml` format:
  scenarios (`when`/`then`), the state store, arg matchers, templating, built-in
  `ls`/`cat`, MCP mocking, `controls`, agent sessions, and terminal scoping
  (`when.terminal`). This is the contract the engine in
  `app/packages/simulator/src/engine/` implements.
- **[`spec/labspace.md`](spec/labspace.md)** — the `labspace.yaml` format: the
  top-level lab config (title, optional `catalog:` block, `simulator:` reference,
  `terminals`, `files` seed, `sections`, `variables`, `services`) plus the
  section-markdown authoring surface (code-fence meta, `$$variable$$`, directives).
- **[`spec/catalog.md`](spec/catalog.md)** — the `labs/<id>/` layout and the
  generated `labs.json` catalog (one entry opens directly; several show a landing
  page), plus `kind` — what an entry IS.
- **[`spec/slidedeck.md`](spec/slidedeck.md)** — `kind: slides`: splitting markdown
  into slides on `---`, `Note:` speaker notes, `:::fragment` reveals, `::terminal`
  live demos, plus per-slide config, the six layouts, the `:::stat`/`:::card`/`:tag`
  components, and the Docker theme.

When changing engine behaviour or the YAML shapes, **keep these specs in sync**.

## Layout

```
app/                 THE PRODUCT — the consolidated static React app
  embed.html         THE EMBED HARNESS — mounts <Labspace> on a page with no
                     Bootstrap, router, toasts or app CSS. Built by `npm run
                     build`; the check that the runtime is really embeddable
  packages/
    labspace/        THE LAB RUNTIME — @dockersamples/simspace-labspace: the
                     instructions pane, the terminal pane, the contexts, and the
                     loader, behind <Labspace>. Extracted so Docker Learn can
                     embed a lab. Own README and tests
    simulator/       THE REUSABLE CORE — @dockersamples/simspace-simulator, an
                     npm workspace. Own README, tests, and typecheck.
      src/engine/    in-browser scenario engine (TypeScript). Entry: index.ts
                     — manifest.ts (parse), match.ts, run.ts, apply.ts,
                       state.ts, filesystem.ts, template.ts, ci.ts (mock CI
                       runs), simulator.ts (facade)
      src/react/     <MockTerminal> (over a Simulator you own) and <SimTerminal>
                     (one terminal from a spec string) + MockTerminal.css
      test/          vitest suite — engine unit tests + React component tests
  src/               WHAT THE RUNTIME ISN'T: this app's shell around it
    labspace/        the glue to the runtime package — LabRoute (router ->
                     labspaceUrl/labKey/section), AppLabspace (brand + adapter +
                     menu), pulseAnalytics, loadEntry (injects parseSlides),
                     DeckProgress, useOfflineMenuItem; catalog.js
    deck/            splitSlides.js — chapter markdown -> slides (fence-aware
                     `---`), per-slide config, and `<!-- region -->` columns
    embed/           entry point for embed.html (the harness)
    components/       Catalog, Deck (DeckView + DeckView.scss carries the layouts
                      and the Docker theme, SlideParts, SlideTerminal,
                      SpeakerNotesWindow, deckDirectives, deckKeys + deckSwipe),
                      ExportView, Insights, PanelWindow
    context/          app-only contexts (Catalog, AppConfig, Deck)
    EntryRoute.jsx   reads the entry's `kind` and dispatches: AppRoute or DeckRoute
  public/
    labs/            SAMPLE ENTRIES — labs/<id>/ (labspace.yaml + *.md, plus a
                     simulator.yaml for labs). Includes a slide deck
                     (tour-of-docker-slides) paired with its lab. The app reads a
                     generated labs.json: one entry opens directly, several show a
                     landing page. labs.json is git-ignored.
  scripts/           Node tooling: validate-lab.ts (linter + catalog regen),
                     catalog.mjs + generate-catalog.mjs (build labs.json), run-ts.mjs
  dist/              build output — generated, do not edit
pulse/               OPTIONAL presence + analytics backend (Node/TS, its own
                     README). Labs are still static and server-free; a lab opts
                     in via a `tracking:` block. Not built by the app pipeline.
spec/                the format specifications + catalog (see above)
kit/                 THE AUTHORING KIT — a Docker Sandboxes mixin kit published
                     as dockersamples/simspace-authoring-kit. spec.yaml + files/, carrying
                     the three authoring skills author repos consume. See below
scripts/             publish-kit.sh — packages kit/ and pushes the OCI artifact
.github/workflows/   deploy.yml (Pages for THIS repo) + deploy-lab.yml (reusable
                     workflow author repos call to validate + deploy their labs)
                     + publish-kit.yml (publishes kit/)
Dockerfile           two images: `production` (nginx runtime) + `authoring`
                     (Node + validate-lab, for author dev/CI)
docker-bake.hcl      bake targets: app / app-local, authoring / authoring-local
compose.yaml         local dev stack (app Vite + pulse); `docker compose up --build`
```

## Two packages, and the rule that keeps them honest

`app/packages/labspace/` (`@dockersamples/simspace-labspace`) holds the lab
RUNTIME — instructions pane, terminal pane, contexts, loader — behind a single
`<Labspace>` component, so a site that isn't this one can mount a lab. Docker
Learn (`docs.docker.com/learn`) is the first such host; this app is simply the
runtime's other consumer.

**The app supplies globals a host won't**, which is the trap: Bootstrap loaded
globally, `data-bs-theme` on `<html>`, an icon font at `/material-symbols.woff2`,
a react-router above everything, a `ToastContainer`. So **"the app still works"
proves nothing about embedding**. `app/embed.html` is the check that does — a
host page carrying none of that, built by `npm run build` so it can't rot. Run it
with `npm run dev` and open `/embed.html`.

**Both packages ship built output, not source.** `app/scripts/build-package.mjs`
compiles JSX/TS to ESM and SCSS to one `dist/styles.css`, and `prepack` runs it so
`npm pack`/`publish` can't ship stale files. This is not cosmetic: shipping source
forced every consumer to set `vite.ssr.noExternal` and to grow an
`optimizeDeps.include` list one browser error at a time. Two rules the build
enforces, because both fail silently in a monorepo — every bare import must be a
declared dependency (npm hoists the app's `node_modules`, so an undeclared one
still resolves here), and every `url()` in the emitted CSS must resolve.

The compiled modules deliberately **do not import their own CSS**; a consumer
imports `@dockersamples/simspace-labspace/styles.css` once. A server render loads
the package through Node, and Node cannot load a `.css` file — that is the whole
reason `ssr.noExternal` gets recommended, and this avoids needing it.

`vite.config.js` and `vitest.config.js` alias both package names to their
**source**, so this app hot-reloads package edits and never tests a stale `dist/`.

Everything the runtime needs from the app is **injected**, never imported:
`loadLabspace(url, { parseSlides })` (decks are the app's), `analytics` (pulse is
the app's), `menuItems` (the service worker is the app's), `wrapTerminal` (the
pop-out window is the app's). The package never imports from `app/src/`.

The deck is NOT in the package (slides are out of scope for Learn) but it does
consume it: `DeckRoute` mounts the package's providers, and `DeckView` passes
`components={deckDirectives}` to the package's `MarkdownRenderer`, which is why
that renderer takes an extensible component map instead of importing slide parts.

## The simulator is a package, not app code

`app/packages/simulator/` (`@dockersamples/simspace-simulator`) holds the engine
and the terminal component. It's a separate package because the terminal is
wanted in **more surfaces than the lab app** — docs pages, the www site, and
in-slide live demos all want a scripted terminal without the instructions pane,
progress tracking, or catalog. The app is simply its first consumer.

Rules that keep that real:

- **The dependency runs one way.** The package never imports from `app/src/` —
  `tsconfig.json` sets `rootDir: src`, so `npm run typecheck` fails on any import
  that escapes. This matters because the app consumes the package's TypeScript
  **source** (no build step), so nothing else would catch it.
- **The engine stays pure.** No DOM, browser API, network, clock, randomness, or
  timers — that's what makes "same commands ⇒ same output" true and lets the same
  machine run in a lab, a docs page, and a test. `test/engine/purity.test.ts`
  asserts it by scanning the source, so a convenience `Date.now()` fails CI.
- **Lab vocabulary stays in the app.** The package knows about specs, terminals,
  and state; it knows nothing about labs, sections, steps, progress, or pulse.
  Persistence is the example: the terminal takes an opaque `storageKey` (and
  persists nothing without one), and the app composes the lab-namespaced key.
- **New app features consume the public API** (`.` and `./react`), rather than
  reaching into `src/engine/*` — if a feature needs something the API doesn't
  expose, widen the API deliberately.

Only `TerminalPanel` and `TerminalContext` in the **labspace package**, plus
`scripts/validate-lab.ts` (engine, for linting labs), import it.

## Two images, one lab-as-data model

The app is **lab-agnostic**: it reads a generated `labs.json` catalog and fetches
each `labs/<id>/labspace.yaml` at runtime, so labs are swappable data, not
baked-in code. That shapes the authoring/deploy story:

- **Runtime image** (`Dockerfile` `production` target) — nginx + built `dist`.
  Authors base their deploy on it and swap in their `labs/` (regenerating
  `labs.json`); no app rebuild. Its static payload can also be extracted for
  GitHub Pages (see `deploy-lab.yml`).
- **Authoring image** (`authoring` target) — Node + app source + `validate-lab` +
  catalog generation, for `npm run dev` (live preview) and linting. Authors mount
  only their `labs/`.

Release both under the **same tags** so a version-pinned lab gets a matching
pair: `TAGS=1.0.0,1 docker buildx bake --push`. An author's repo — bootstrapped
from the separate **`dockersamples/simspace-starter`** template — is just their
`labs/` plus this tooling.

## The authoring kit — `kit/`

A third published artifact, and the one that carries **agent** knowledge of the
format: a [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/customize/kits/)
mixin kit pushed to `docker.io/dockersamples/simspace-authoring-kit`.

```
kit/
  spec.yaml     kind: mixin — agentInstructions, network allow-list, ports 5173/8888
  README.md     the Docker Hub overview
  files/home/.claude/skills/
    authoring-lab/          sections, scenarios, milestones, labspace reference
    authoring-slidedeck/    kind: slides — layouts, theme, components, demos
    importing-slidedeck/    pptx/PDF → deck, plus two stdlib-only inventory tools
```

`files/home/` lands in the sandbox's `/home/agent/`, so the skills install as
personal skills the agent picks up automatically. A mixin's
`agentInstructions.content` is written to `kits-memory/simspace.md` and indexed
from the agent's memory file.

**Why it's here and not in the starter.** The skills used to be committed into
`simspace-starter`, so every generated repo froze them at generation time —
slide decks, milestones and output pacing all shipped to repos whose agents had
never heard of them, and only regenerating the repo fixed that. Versioned here,
beside the `spec/` files that define the format, they're re-resolved on every
`sbx env run`. **So when you change a format in `spec/`, the kit's skills are
part of the change**, the same way the specs and the engine are.

`.github/workflows/publish-kit.yml` publishes it: a push to `main` touching
`kit/` gets `<YYYYMMDD>-<sha>` and moves `latest`; a `kit/vX.Y.Z` tag cuts that
version and moves nothing. Pull requests validate and plan without publishing.
The work is in `scripts/publish-kit.sh`, so it can be dry-run locally:

```bash
DRY_RUN=1 ./scripts/publish-kit.sh v1.0.0
```

The kit's version is independent of the image tags above — it describes the kit
(skills, guidance, ports, network), not the app.

## Commands

This is a **JavaScript/React (Vite) project** — all work happens in `app/`.

**The packages' and the app's pure logic are unit-tested; the React UI is not.**
`npm test` runs three suites (simulator, labspace, app) and must stay
green — add cases for new behaviour. The app suite covers the pieces where a subtle
bug wouldn't be obvious on screen, above all slide splitting. For the React UI
there's no suite: verify that by running the app and exercising it, plus lint. The
one exception is the deck's swipe hook (`deckSwipe.test.jsx`, which opts into jsdom
with a `@vitest-environment` comment) — reproducing a gesture by hand means picking
up a phone.

Verify **lab content** (the `labspace.yaml` / `simulator.yaml` / markdown) with
`npm run validate-lab` — always run it after editing a lab.

```bash
cd app
npm install             # also links the packages/simulator workspace
npm run dev             # local dev server (0.0.0.0), serves app/public/labs/
npm run build           # static build → app/dist (emits labs.json)
npm run build:packages  # compile both workspace packages → packages/*/dist
npm run preview         # serve the production build
npm test                # vitest — the simulator, labspace, and app suites
npm run test:watch      # the same suite in watch mode
npm run typecheck       # tsc on the simulator package (also enforces its boundary)
npm run lint            # ESLint (JS/JSX only — the package is covered by typecheck)
npm run prettier-check  # Prettier (use `npm run prettier` to auto-format)
npm run validate-lab    # validate every lab under public/labs + regenerate labs.json
npm run generate-catalog -- public/labs public/labs.json   # write labs.json only
```

`validate-lab` (`scripts/validate-lab.ts`) validates **every** lab under
`public/labs` with the **real engine parser** — reporting dangling `contentPath` /
`simulator` / `terminal-id` / `when.terminal` / `then.ci.workflow` references,
`{{ args.X }}` placeholders with no matching capture, and markdown Run-button
commands nothing handles — and **regenerates `labs.json`** from the labs. It fails
if no labs are found (the migration case for a repo not yet on `labs/<id>/`).
Errors exit non-zero (CI-gating); warnings don't. `labs.json` is never
hand-written: the Vite plugin, `validate-lab`, and `generate-catalog` all build it
from each `labspace.yaml` via `scripts/catalog.mjs`, so it can't drift. Scripts
run via `scripts/run-ts.mjs`, which esbuild-bundles a TS entry so Node can import
the engine directly (no `tsx`/`ts-node`).

The engine is TypeScript and consumed as **source** — Vite compiles it as part of
the app, with no build step for the package. `@dockersamples/simspace-simulator`
(and `/react`) is its public surface for embedding or testing; see
`app/packages/simulator/README.md`.

## Conventions

- Match the surrounding style; run `npm run prettier` before finishing and
  `npm run lint` to check.
- The simulator package is TypeScript; the app's React UI is `.jsx`/`.scss`. Keep
  the engine free of React/DOM dependencies — it is a pure state machine.
- The engine must stay **deterministic**: no time, randomness, network, or LLM
  calls in scenario evaluation (streaming/pacing in `settings` is cosmetic only).
  `npm test` enforces this — see "The simulator is a package" above.
- Each lab lives in its own directory under `app/public/labs/` (`labs/<id>/`);
  the app discovers them via the generated `labs.json` catalog. Keeping labs
  self-contained lets a Docker dev environment mount just the `labs/` directory.
- Paths referenced from a `labspace.yaml` (`simulator:`, `contentPath`) resolve
  relative to that file itself, so they stay simple within `labs/<id>/`.

## Gotchas

- **`app/` is the only live code.** Earlier directories (`interface/`,
  `sbx-simulator-web/`, `kit/`) were removed when the project consolidated into a
  single static app. The `spec/` files are the source of truth for the YAML
  formats. This project is JavaScript-only — there is no Go code.
- **All terminals share one simulator instance** — one state tree and one
  virtual filesystem. A command in one terminal is visible in the others.
  Scenarios scope to a terminal with `when.terminal: <id>`; ids come from
  `labspace.yaml`'s `terminals:`. This holds across a deck's slides too: a
  container started on slide 4 is still running on slide 9.
- **Slide sizes are in `cqi`, and `app/.prettierignore` covers lab content.** Two
  deck decisions that are easy to undo by accident. The slide canvas is a 16:9
  container and every type size is a percentage of its width, so a stray `px` in
  `DeckView.scss` stops scaling with the slide — see the header comment there for
  the 1920÷19.2 conversion. **A component the deck SHARES with the lab has to expose
  its sizes as custom properties** (`--cb-*` in `App.scss`, `--mock-term-*` in the
  simulator package) — a px there can't be overridden from the deck, because
  `div.code-block .x` outranks `.deck-canvas .x` and the deck's rules lose silently.
  That one stayed hidden until a phone, where the block rendered 3x oversized while
  the slide scaled down around it. And Prettier is kept away from `public/labs/**` because
  it rewrites `***`/`___` to `---`, which is the slide separator; re-enabling it
  would let a formatting pass split a slide in two.
- **A deck's demo terminal owns its keystrokes.** While focus is inside
  `.slide-terminal`, DeckView's keyboard handler stands down — otherwise typing
  `docker ps` would flip slides on the space. `Esc` hands control back. If you
  touch either side of this, re-check it in a browser: the trap is that
  MockTerminal _unmounts its input row while output streams_, so focus lands on a
  wrapper rather than an input. **Swipe navigation defers to the same region**
  (`deckSwipe.js` reuses `isTypingTarget`), plus anything that pans sideways, and
  it suppresses the click a browser fires after a swipe so a gesture can't advance
  twice — `deckSwipe.test.jsx` pins all three.
- **A render error must never reach the top of the tree.** `MarkdownHooks`
  (react-markdown) _rethrows a plugin failure during render_, and mermaid renders in
  the BROWSER, so a diagram one device can't draw used to unmount the whole app —
  white screen, mid-talk, no way out but a reload. Two things hold that line and
  both are easy to remove by accident: `errorFallback` on `rehype-mermaid`
  (`markdown/diagramError.js`) and `SlideErrorBoundary` inside the deck canvas. The
  boundary must stay INSIDE the canvas, so chrome and navigation survive a bad
  slide, and it relies on the canvas's `key={current.id}` to reset.
- **`app/dist/` is generated** by `npm run build` — never edit it. Edit the lab
  sources under `app/public/labs/`. `app/public/labs.json` is generated too
  (git-ignored) — never hand-edit it; change a lab's `labspace.yaml` instead.

## Deploying

### This repo (the platform + sample lab)

- **GitHub Pages** — pushing to `main` triggers `.github/workflows/deploy.yml`,
  which builds `app/` and publishes `app/dist`. The app uses relative asset
  paths (`base: "./"`) and hash routing, so it works from a project subpath.
- **Any static host** — `npm run build` in `app/`, upload `app/dist`.
- **Images** — `docker buildx bake` builds both the runtime (`app`) and
  authoring (`authoring`) images; `--push` publishes. Use `*-local` targets to
  load a single-arch build into the daemon.

### An author's lab repo (from `dockersamples/simspace-starter`)

Labs are runtime data, so an author repo never rebuilds the app:

- **Dev** — `docker compose up dev` (authoring image + mounted `labs/`); lint with
  `docker compose run --rm validate`. The catalog is generated on the fly.
- **GitHub Pages** — the caller `deploy.yml` invokes this repo's reusable
  `deploy-lab.yml@<ref>`, which validates the labs, overlays them onto the runtime
  image's static payload, generates `labs.json`, and publishes.
- **Container** — the starter's `Dockerfile` generates `labs.json` with the
  authoring image, then `FROM <runtime> + COPY labs/ + labs.json`; `docker run
-p 8080:80` serves it.
