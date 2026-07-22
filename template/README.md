# My Labspace lab

An interactive, fully in-browser lab built on
[Labspace](https://github.com/dockersamples/sbxlab). Everything in the terminal
is simulated — no real Docker, backend, or network — so it runs the same for
everyone, with nothing to install.

You edit the lab under [`lab/`](lab/); the app that runs it is a prebuilt image,
and the lab is loaded at runtime, so there's no build step for content.

## Author locally

You only need Docker.

```bash
docker compose up dev              # live preview at http://localhost:5173
docker compose run --rm validate   # lint the lab (fails on errors)
```

Edit the files in `lab/` and refresh the browser to see changes:

- `lab/labspace.yaml` — title, terminals, seed files, sections, variables
- `lab/simulator.yaml` — what each command does (scenarios)
- `lab/*.md` — one file per section of instructions

Pin the toolchain to a released version for reproducibility:

```bash
export LABSPACE_AUTHORING_IMAGE=dockersamples/labspace-authoring:1
```

## Deploy

**GitHub Pages (default):** enable Pages (Settings → Pages → Source: "GitHub
Actions"), then push to `main`. The workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) validates the lab
and publishes it. Pin `runtime-tag` there to a released version for a stable lab.
Pull requests are validated first by
[`.github/workflows/validate.yml`](.github/workflows/validate.yml).

**As a container:** the [`Dockerfile`](Dockerfile) bases on the runtime image and
swaps in your lab.

```bash
docker build -t my-lab .
docker run --rm -p 8080:80 my-lab    # http://localhost:8080
```

## Authoring with an AI agent

This repo is set up for agent authoring. In Claude Code, an `authoring-lab` skill
(under `.claude/`) knows the workflow, `docker compose` / `validate-lab` are
pre-allowed, and a hook auto-validates the lab after every edit under `lab/`.
[`CLAUDE.md`](CLAUDE.md) loads the guide automatically.

## Learn more

See [`AGENTS.md`](AGENTS.md) for an authoring cheat-sheet, and the
[Labspace specs](https://github.com/dockersamples/sbxlab/tree/main/spec) for the
full `simulator.yaml` / `labspace.yaml` reference.
