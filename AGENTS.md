# AGENTS.md

Agent-oriented guide to this repository. Read this first to load context quickly.

## What this is

A **static, server-free learning runtime**. Authors write a lab (instructional
markdown + a scenario spec); learners get a browser-based **mock terminal** that
responds to any command deterministically — no backend, no AI API keys, no
network, no real Docker. The whole thing is a React app that fetches its lab
config at startup and simulates every command in-browser, deployable to any
static host.

The simulator is a config-driven, in-memory **state machine**: each command the
learner types is matched against author-declared scenarios (first-match-wins)
and produces the same output, file changes, and state transitions every time.

## Specifications — read these before touching the engine or lab files

The two YAML file formats that drive everything are fully specified in `spec/`:

- **[`spec/simulator.md`](spec/simulator.md)** — the `simulator.yaml` format:
  scenarios (`when`/`then`), the state store, arg matchers, templating, built-in
  `ls`/`cat`, MCP mocking, `controls`, agent sessions, and terminal scoping
  (`when.terminal`). This is the contract the engine in `app/src/engine/`
  implements.
- **[`spec/labspace.md`](spec/labspace.md)** — the `labspace.yaml` format: the
  top-level lab config (title, `simulator:` reference, `terminals`, `files`
  seed, `sections`, `variables`, `services`) plus the section-markdown authoring
  surface (code-fence meta, `$$variable$$` substitution, directives).

When changing engine behaviour or the YAML shapes, **keep these specs in sync**.

## Layout

```
app/                 THE PRODUCT — the consolidated static React app
  src/
    engine/          in-browser scenario engine (TypeScript). Entry: index.ts
                     — manifest.ts (parse), match.ts, run.ts, apply.ts,
                       state.ts, filesystem.ts, template.ts, ci.ts (mock CI
                       runs), simulator.ts (facade)
    labspace/        fetch + parse labspace.yaml; slug + $$variable$$ substitution
    terminal/        <MockTerminal> mock terminal component
    components/       WorkshopPanel (instructions + markdown), TerminalPanel, ExportView
    context/          React contexts (Workshop, Tab, Terminal, PrintMode)
  public/
    lab/             a complete SAMPLE LAB (labspace.yaml + simulator.yaml + *.md)
                     — the default lab, loaded from lab/labspace.yaml
  scripts/           Node tooling: validate-lab.ts (lab linter) + run-ts.mjs
                     (esbuild TS runner so scripts can import the engine)
  dist/              build output — generated, do not edit
spec/                the two format specifications (see above)
template/            starter files for an author's OWN lab repo (lab/ + compose +
                     Dockerfile + AGENTS.md + a caller deploy workflow)
.github/workflows/   deploy.yml (Pages for THIS repo) + deploy-lab.yml (reusable
                     workflow author repos call to validate + deploy their lab)
Dockerfile           two images: `production` (nginx runtime) + `authoring`
                     (Node + validate-lab, for author dev/CI)
docker-bake.hcl      bake targets: app / app-local, authoring / authoring-local
```

## Two images, one lab-as-data model

The app is **lab-agnostic**: it fetches `lab/labspace.yaml` at runtime, so a lab
is swappable data, not baked-in code. That shapes the authoring/deploy story:

- **Runtime image** (`Dockerfile` `production` target) — nginx + built `dist`.
  Authors base their deploy on it and swap in their `lab/`; no app rebuild. Its
  static payload can also be extracted for GitHub Pages (see `deploy-lab.yml`).
- **Authoring image** (`authoring` target) — Node + app source + `validate-lab`,
  for `npm run dev` (live preview) and linting. Authors mount only their `lab/`.

Release both under the **same tags** so a version-pinned lab gets a matching
pair: `TAGS=1.0.0,1 docker buildx bake --push`. An author's repo is just the
`template/` contents with their own `lab/`.

## Commands

This is a **JavaScript/React (Vite) project** — all work happens in `app/`.
There is currently **no unit-test suite** (no `test` script); verify engine/UI
changes by running the app and exercising the lab, plus lint. Verify **lab
content** (the `labspace.yaml` / `simulator.yaml` / markdown) with
`npm run validate-lab` — always run it after editing a lab.

```bash
cd app
npm install
npm run dev             # local dev server (0.0.0.0), serves app/public/lab/ sample lab
npm run build           # static build → app/dist
npm run preview         # serve the production build
npm run lint            # ESLint
npm run prettier-check  # Prettier (use `npm run prettier` to auto-format)
npm run validate-lab -- public/lab   # static lint of a lab directory (default: public/lab)
```

`validate-lab` (`scripts/validate-lab.ts`) parses a lab with the **real engine
parser** and reports authoring mistakes without any hand-written assertions:
dangling `contentPath` / `simulator` / `terminal-id` / `when.terminal` /
`then.ci.workflow` references, `{{ args.X }}` placeholders with no matching
capture, and markdown Run-button commands that no scenario, built-in, or agent
prompt can handle. Errors exit non-zero (CI-gating); warnings don't. It runs via
`scripts/run-ts.mjs`, which esbuild-bundles a TS entry so Node scripts can import
the engine directly (no `tsx`/`ts-node` needed).

The engine (`app/src/engine/`) is written in TypeScript and consumed directly by
Vite; `app/src/engine/index.ts` is its public surface for embedding or testing.

## Conventions

- Match the surrounding style; run `npm run prettier` before finishing and
  `npm run lint` to check.
- Engine code is TypeScript; the React UI is `.jsx`/`.scss`. Keep the engine
  free of React/DOM dependencies — it is a pure state machine.
- The engine must stay **deterministic**: no time, randomness, network, or LLM
  calls in scenario evaluation (streaming/pacing in `settings` is cosmetic only).
- The lab lives in its own directory (`app/public/lab/`) and is loaded from
  `lab/labspace.yaml` by default (overridable with `?lab=<path>`). Keeping it
  self-contained lets a Docker dev environment mount just that directory.
- Paths referenced from `labspace.yaml` (`simulator:`, `contentPath`) resolve
  relative to the `labspace.yaml` file itself, so they stay simple within `lab/`.

## Gotchas

- **`app/` is the only live code.** Earlier directories (`interface/`,
  `sbx-simulator-web/`, `kit/`) were removed when the project consolidated into a
  single static app. The `spec/` files are the source of truth for the YAML
  formats. This project is JavaScript-only — there is no Go code.
- **All terminals share one simulator instance** — one state tree and one
  virtual filesystem. A command in one terminal is visible in the others.
  Scenarios scope to a terminal with `when.terminal: <id>`; ids come from
  `labspace.yaml`'s `terminals:`.
- **`app/dist/` is generated** by `npm run build` — never edit it. Edit the lab
  sources under `app/public/lab/`.

## Deploying

### This repo (the platform + sample lab)

- **GitHub Pages** — pushing to `main` triggers `.github/workflows/deploy.yml`,
  which builds `app/` and publishes `app/dist`. The app uses relative asset
  paths (`base: "./"`) and hash routing, so it works from a project subpath.
- **Any static host** — `npm run build` in `app/`, upload `app/dist`.
- **Images** — `docker buildx bake` builds both the runtime (`app`) and
  authoring (`authoring`) images; `--push` publishes. Use `*-local` targets to
  load a single-arch build into the daemon.

### An author's lab repo (uses `template/`)

The lab is runtime data, so an author repo never rebuilds the app:

- **Dev** — `docker compose up dev` (authoring image + mounted `lab/`); lint with
  `docker compose run --rm validate`.
- **GitHub Pages** — the caller `deploy.yml` invokes this repo's reusable
  `deploy-lab.yml@<ref>`, which validates the lab, overlays it onto the runtime
  image's static payload, and publishes.
- **Container** — `template/Dockerfile` is `FROM <runtime> + COPY lab/` (two
  lines); `docker run -p 8080:80` serves it.
