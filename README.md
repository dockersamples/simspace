# Labspaces, rethinked

A reusable platform for building deterministic, interactive learning experiences
— without requiring production infrastructure, AI API keys, or organizational
permissions.

Authors write a scenario file and instructional content; learners get a
browser-based mock terminal that responds to any command predictably, every
time. The whole experience is **static**: a React app that fetches its lab
config at startup and simulates every command in the browser, so it can be
deployed to any static host (GitHub Pages, S3, Netlify, …) with no backend.

## Why a simulator?

Real CLI workflows depend on AI providers, Docker Hub organizations, API keys,
and network connectivity — none of which a learner can be guaranteed to have.
Generative AI is also non-deterministic: the same prompt produces different
output every time, which makes for a poor educational experience.

The simulator removes all of those dependencies. It is a config-driven,
in-memory state machine: every command is matched against author-declared
scenarios and produces the exact same output, file changes, and state
transitions — every time, on any machine, with no external services required.
Any command can be simulated (`docker run`, `kubectl apply`, `git push`, …);
authors control exactly what happens.

## Repository layout

```
app/                  the consolidated static app (build + deploy this)
  src/
    labspace/         fetches + parses labspace.yaml, variable substitution
    engine/           in-browser scenario engine (TypeScript)
    terminal/         <SbxTerminal> mock terminal component
    components/       instructions panel, terminal panel, markdown renderer
  public/
    lab/              a sample lab (labspace.yaml + simulator.yaml + *.md)
spec/                 specifications for the two YAML formats
AGENTS.md             onboarding guide for agentic coding sessions
Dockerfile            builds app/ and serves it with nginx (optional)
docker-bake.hcl       bake targets for the static-app image
.github/workflows/    GitHub Pages deploy workflow
```

`app/` is the product — a single, self-contained static app. The two YAML
formats it consumes are specified under [`spec/`](spec):

- [`spec/labspace.md`](spec/labspace.md) — the `labspace.yaml` lab config.
- [`spec/simulator.md`](spec/simulator.md) — the `simulator.yaml` scenario spec.

## The `app/`

A static React app with two panes: rendered instructional content on the left
and an in-browser simulated terminal on the right. At startup it fetches a
`labspace.yaml` describing the lab, then loads the referenced simulator spec and
markdown files as static assets. "Run" buttons feed commands into the terminal
and "Save" buttons write files into the terminal's virtual filesystem — all
client-side, no server.

```bash
cd app
npm install
npm run dev        # local dev server, serves the sample lab in app/public/lab/
npm run build      # static build → app/dist
npm run preview    # serve the production build
```

## Authoring a lab

A lab is a `labspace.yaml` plus the files it references, kept together in a
`lab/` directory. The app loads `lab/labspace.yaml` by default; all paths inside
it are resolved relative to the `labspace.yaml`, so they stay simple
(`simulator.yaml`, `00-intro.md`). Keeping the lab in its own directory means a
Docker dev environment can mount just that directory without clobbering the
app's own assets. Deploy one lab per site (or host several and select with
`?lab=<path>`):

```yaml
title: "My Lab"
description: "One-line summary shown in the header."
simulator: simulator.yaml        # scenario spec (relative path)
files:                           # optional seed for the virtual filesystem
  app/server.js: "// starter code\n"
sections:
  - title: Introduction
    contentPath: 00-intro.md
  - title: Run something
    contentPath: 01-run.md
variables:
  containerName: web
services:                        # optional external-URL tabs (iframes)
  - title: Docs
    url: https://example.com
```

- **`simulator.yaml`** declares scenarios for each command a learner runs. See
  [`spec/simulator.md`](spec/simulator.md) for the full scenario reference, and
  [`spec/labspace.md`](spec/labspace.md) for every `labspace.yaml` field.
- **Markdown sections** use `$$variable$$` substitution and support runnable
  code blocks (a Run button), `save-as=<path>` blocks (a Save button), file
  links, variable prompts, and OS-conditional content.

The sample lab under [`app/public/lab/`](app/public/lab) is a complete, working
example — copy it as a starting point.

## Deploying

- **GitHub Pages** — push to `main`; the workflow in
  [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `app/`
  and publishes `app/dist`. Enable Pages with source "GitHub Actions". The app
  uses relative asset paths (`base: "./"`) and hash-based routing, so it works
  from a project subpath.
- **Any static host** — run `npm run build` in `app/` and upload `app/dist`.
- **Container** — `docker buildx bake app-local` builds an nginx image serving
  the static site.
