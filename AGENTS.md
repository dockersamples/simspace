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
  packages/
    simulator/       THE REUSABLE CORE — @dockersamples/simspace-simulator, an
                     npm workspace. Own README, tests, and typecheck.
      src/engine/    in-browser scenario engine (TypeScript). Entry: index.ts
                     — manifest.ts (parse), match.ts, run.ts, apply.ts,
                       state.ts, filesystem.ts, template.ts, ci.ts (mock CI
                       runs), simulator.ts (facade)
      src/react/     <MockTerminal> (over a Simulator you own) and <SimTerminal>
                     (one terminal from a spec string) + MockTerminal.css
      test/          vitest suite — engine unit tests + React component tests
  src/
    labspace/        fetch + parse labspace.yaml; slug + $$variable$$ substitution
    deck/            splitSlides.js — chapter markdown -> slides (fence-aware
                     `---`), per-slide config, and `<!-- region -->` columns
    components/       WorkshopPanel (instructions + markdown), TerminalPanel,
                      Deck (DeckView + DeckView.scss carries the layouts and the
                      Docker theme, SlideParts, SlideTerminal, SpeakerNotesWindow),
                      ExportView
    context/          React contexts (Workshop, Tab, Terminal, Deck, PrintMode)
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
.github/workflows/   deploy.yml (Pages for THIS repo) + deploy-lab.yml (reusable
                     workflow author repos call to validate + deploy their labs)
Dockerfile           two images: `production` (nginx runtime) + `authoring`
                     (Node + validate-lab, for author dev/CI)
docker-bake.hcl      bake targets: app / app-local, authoring / authoring-local
compose.yaml         local dev stack (app Vite + pulse); `docker compose up --build`
```

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

Only `TerminalPanel` (component) and `TerminalContext` (Simulator instance) in
the app, plus `scripts/validate-lab.ts` (engine, for linting labs), import it.

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

## Commands

This is a **JavaScript/React (Vite) project** — all work happens in `app/`.

**The `simulator` package and the app's pure logic are unit-tested; the React UI
is not.** `npm test` runs both suites (the package's, then the app's) and must stay
green — add cases for new behaviour. The app suite covers the pieces where a subtle
bug wouldn't be obvious on screen, above all slide splitting. For the React UI
there's no suite: verify that by running the app and exercising it, plus lint. Verify **lab content** (the
`labspace.yaml` / `simulator.yaml` / markdown) with `npm run validate-lab` —
always run it after editing a lab.

```bash
cd app
npm install             # also links the packages/simulator workspace
npm run dev             # local dev server (0.0.0.0), serves app/public/labs/
npm run build           # static build → app/dist (emits labs.json)
npm run preview         # serve the production build
npm test                # vitest — the simulator package's suite
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
  the 1920÷19.2 conversion. And Prettier is kept away from `public/labs/**` because
  it rewrites `***`/`___` to `---`, which is the slide separator; re-enabling it
  would let a formatting pass split a slide in two.
- **A deck's demo terminal owns its keystrokes.** While focus is inside
  `.slide-terminal`, DeckView's keyboard handler stands down — otherwise typing
  `docker ps` would flip slides on the space. `Esc` hands control back. If you
  touch either side of this, re-check it in a browser: the trap is that
  MockTerminal *unmounts its input row while output streams*, so focus lands on a
  wrapper rather than an input.
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
