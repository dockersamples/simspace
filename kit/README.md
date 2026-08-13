# Simspace Authoring kit

A [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) **mixin kit** that
turns a sandbox into a Simspace authoring environment: the authoring skills, the
guidance, the ports the preview needs, and the hosts the loop reaches.

```console
$ sbx run claude --kit docker.io/dockersamples/simspace-authoring-kit:latest
```

More usually you don't type that at all — a repo generated from
[`simspace-starter`](https://github.com/dockersamples/simspace-starter) ships a
`.sbxenv.yaml` that names this kit, so authors run:

```console
$ sbx env run
```

## Why it exists

The three authoring skills used to be committed into `simspace-starter`, which
meant every repo generated from it froze the skills at the moment of generation.
The Simspace format kept moving — slide decks, milestones, output pacing, deck
import — and a lab repo created before any of those landed had an agent that had
never heard of them. Only regenerating the repo fixed it, which nobody does.

Here the skills are versioned alongside the platform that defines the format, and
re-resolved every time a sandbox is created. A lab repo from six months ago
authors against today's Simspace.

## What it ships

| | |
| --- | --- |
| **Skills** | `authoring-lab`, `authoring-slidedeck`, `importing-slidedeck`, installed to `~/.claude/skills/` |
| **Agent instructions** | Orientation, the authoring loop, and the rules that are easy to get wrong — written to `kits-memory/simspace.md` and indexed from the agent's memory file |
| **Ports** | `5173` (live preview) and `8888` (pulse — presence, analytics, the instructor insights dashboard) |
| **Network** | Docker Hub, so the engine in the sandbox can pull the Simspace images; `raw.githubusercontent.com` / `api.github.com` / `github.com`, for [`sample-cli-output`](https://github.com/dockersamples/sample-cli-output) and the specs |

Nothing is installed: the authoring toolchain is the prebuilt
`dockersamples/simspace-authoring` image, run by `docker compose` inside the
sandbox. The default sandbox templates carry a Docker engine, so that works with
no extra setup.

## The skills

- **authoring-lab** — sections, `simulator.yaml` scenarios, milestones,
  terminals, controls, seed files, and the `labspace.yaml` reference.
- **authoring-slidedeck** — `kind: slides`: layouts, the theme, speaker notes,
  fragments, the stat/card components, and the in-slide demo terminal.
- **importing-slidedeck** — converting a PowerPoint, Keynote, Google Slides or
  PDF deck into a Simspace deck by rebuilding each slide from its real structure
  rather than screenshotting it. Carries two stdlib-only Python inventory tools.

## Versions

`latest` tracks `main` of
[`dockersamples/simspace`](https://github.com/dockersamples/simspace) — which is
the point, since staying current is what this kit is for. Released versions are
published as `vX.Y.Z` for a workshop that needs a fixed target:

```yaml
# .sbxenv.yaml
kits:
  - docker.io/dockersamples/simspace-authoring-kit:v1.0.0
```

Kits are applied when a sandbox is **created**. An existing sandbox keeps the
skills it was built with — `sbx env rm && sbx env run` to pick up a newer kit.

## Source

Built from [`kit/`](https://github.com/dockersamples/simspace/tree/main/kit) in
the Simspace repository, and published by its `publish-kit.yml` workflow.
