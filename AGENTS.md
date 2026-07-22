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
  dist/              build output — generated, do not edit
spec/                the two format specifications (see above)
.github/workflows/   GitHub Pages deploy workflow
Dockerfile           builds app/ and serves it with nginx (optional container path)
docker-bake.hcl      bake targets for the static-app image
```

## Commands

This is a **JavaScript/React (Vite) project** — all work happens in `app/`.
There is currently **no test suite** (no `test` script); verify changes by
running the app and exercising the lab, plus lint.

```bash
cd app
npm install
npm run dev            # local dev server (0.0.0.0), serves app/public/lab/ sample lab
npm run build          # static build → app/dist
npm run preview        # serve the production build
npm run lint           # ESLint
npm run prettier-check # Prettier (use `npm run prettier` to auto-format)
```

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

- **GitHub Pages** — pushing to `main` triggers `.github/workflows/deploy.yml`,
  which builds `app/` and publishes `app/dist`. The app uses relative asset
  paths (`base: "./"`) and hash routing, so it works from a project subpath.
- **Any static host** — `npm run build` in `app/`, upload `app/dist`.
- **Container** — `docker buildx bake app-local` builds an nginx image.
