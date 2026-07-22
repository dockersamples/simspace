# Introduction

Welcome to your lab, **$$name$$**! This page is `lab/00-intro.md`. Edit it and
the YAML files, then refresh the preview to see your changes.

Every command in the terminal is scripted by `lab/simulator.yaml`. Try one — the
**Run** button types it into the terminal and executes it:

```bash
echo hello
```

Scenarios can capture arguments and echo them back. Run a container:

```bash
docker run hello-world
```

The lab ships with a virtual filesystem. Read a seed file:
:filelink[README.txt]{path="README.txt"}

## Next steps

- Add a section: create `lab/01-....md` and list it under `sections:` in
  `lab/labspace.yaml`.
- Add a command: append a scenario to `lab/simulator.yaml`.
- Validate anytime with `docker compose run --rm validate`.

When it looks right, commit and push — GitHub Pages deploys it automatically.
