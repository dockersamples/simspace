# Lab catalog (`labs.json`)

Every Labspace lab lives in its own directory under `labs/`:

```
labs/
  getting-started/
    labspace.yaml
    simulator.yaml
    00-intro.md
  going-deeper/
    labspace.yaml
    ...
labs.json            # generated — lists what's in labs/
```

`labs.json` is the catalog the app reads at startup. Based on how many labs it
lists, the app either:

- **one lab** — enters it directly, with no landing page and no lab id in the URL
  (`#/`, `#/00-intro`, …); or
- **two or more** — shows a landing page to pick one, then runs it under
  `#/labs/<id>/…`.

Each lab keeps its own saved progress, variables, and terminal transcripts,
namespaced by its id (`simspace:engine:<id>`), so labs never cross-contaminate.

## The catalog is generated — you don't write it

`labs.json` is produced from the labs on disk, so there's a single source of
truth and nothing to hand-maintain or keep in sync. Each lab's card metadata
comes from its own `labspace.yaml`:

- **dev** (`npm run dev`) and **build** (`npm run build`): a Vite plugin serves /
  emits `labs.json` automatically.
- **validate** (`npm run validate-lab`): regenerates it as it checks the labs.
- **anywhere else** (CI, Docker): `npm run generate-catalog -- <labs-dir> <out>`.

All three share `app/scripts/catalog.mjs`, so the output is identical. `labs.json`
is git-ignored — it's an artifact.

### Card metadata: the optional `catalog:` block

A lab's card uses its `labspace.yaml` `title` / `description` by default. Add an
optional `catalog:` block to set an icon, chips, or ordering — or to give the
card a different title from the in-lab header:

```yaml
# labs/getting-started/labspace.yaml
title: "Getting Started (Simulated)" # in-lab header
description: "A fully in-browser lab."
catalog:
  title: "Getting Started" # OPTIONAL card title override (defaults to `title`)
  description: "…" # OPTIONAL card body override (defaults to `description`)
  icon: rocket_launch # OPTIONAL Material Symbols name (default "science")
  tags: ["beginner"] # OPTIONAL chips
  estimatedMinutes: 15 # OPTIONAL "~15 min" hint
  order: 1 # OPTIONAL sort key (ascending; then by title)
```

### Generated entry shape

Each entry in the generated `labs.json` looks like:

| Field              | Source                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `id`               | the lab's directory name (its URL segment + storage namespace)   |
| `path`             | `labs/<id>/labspace.yaml`                                        |
| `title`            | `catalog.title` → `title` → `id`                                 |
| `description`      | `catalog.description` → `description` → `""`                     |
| `icon`             | `catalog.icon` → `"science"`                                     |
| `tags`             | `catalog.tags` → `[]`                                            |
| `estimatedMinutes` | `catalog.estimatedMinutes` → `null`                             |

A directory is a lab iff it contains a `labspace.yaml`. Ordering: `catalog.order`
ascending, then title.

## Validation

`npm run validate-lab -- <labs-dir>` (default `public/labs`) validates **every**
lab under the directory and **regenerates `labs.json`**. It fails (exit 1) if no
labs are found — the deploy-blocking case for a repo that hasn't moved to the
`labs/<id>/` layout — with a hint to migrate. Run it before committing or
deploying; the deploy workflow runs it too.

## Overrides

- `?catalog=<path>` points the app at a different catalog file — handy for
  hosting an internal set and a public set from one build.
