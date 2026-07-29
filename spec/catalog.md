# Lab catalog (`labs.json`)

A single Labspace build can host **one lab** or **many**. The mode is chosen at
runtime by whether a `labs.json` catalog is deployed next to the app:

- **No `labs.json` (default).** The app loads the single lab in `lab/` exactly
  as before. There is no landing page and no lab id in the URL
  (`#/`, `#/00-intro`, …). Existing single-lab deployments need no changes.
- **`labs.json` present.** The app shows a landing page listing every lab. The
  learner picks one, and that lab runs under `#/labs/<id>/…`. Each lab keeps its
  own saved progress, variables, and terminal transcripts.

There is nothing to build or configure beyond dropping the file in place — the
switch is automatic.

## Format

`labs.json` lives alongside `index.html` (the same directory the app is served
from). Paths inside it resolve relative to the app's base URL, just like
`labspace.yaml` paths do, so subpath deploys (e.g. GitHub Pages `/sbxlab/`)
work without changes.

```json
{
  "labs": [
    {
      "id": "docker-tour",
      "path": "labs/docker-tour/labspace.yaml",
      "title": "A Tour of Docker",
      "description": "The Docker CLI, Scout, Sandboxes, and CI.",
      "icon": "sailing",
      "tags": ["docker", "beginner"],
      "estimatedMinutes": 30
    }
  ]
}
```

| Field              | Required | Description                                                                 |
| ------------------ | -------- | --------------------------------------------------------------------------- |
| `id`               | yes      | Stable, URL-safe id. Appears in the URL and **keys the lab's saved state** — don't rename it once learners have progress. |
| `path`             | yes      | Path to the lab's `labspace.yaml`, relative to the app base URL.             |
| `title`            | no       | Card title. Falls back to `id`.                                             |
| `description`      | no       | One-line summary shown on the card.                                        |
| `icon`             | no       | [Material Symbols](https://fonts.google.com/icons) name. Defaults to `science`. |
| `tags`             | no       | Array of strings rendered as chips.                                        |
| `estimatedMinutes` | no       | Shown as a `~N min` chip.                                                  |

An entry is skipped if it lacks `id` or `path`. If the file is missing, empty,
or malformed, the app falls back to single-lab mode.

## Where to put lab content

Keep each catalog lab in its own directory under `labs/` (e.g.
`labs/docker-tour/labspace.yaml`). The offline cache recognizes lab content by
the `lab/` and `labs/` path prefixes, so labs stored elsewhere won't be cached
for offline use.

## Storage isolation

Saved state is namespaced per lab so several labs can coexist:

- Catalog labs use their `id` as the suffix (`simspace:engine:docker-tour`).
- The default single lab uses the original, un-suffixed keys
  (`simspace:engine`), so upgrading a single-lab deployment preserves learners'
  in-progress state.

## Overrides

- `?lab=<path>` forces a specific `labspace.yaml` and bypasses the catalog
  (single-lab view), even when `labs.json` exists.
- `?catalog=<path>` points the app at a different catalog file — handy for
  hosting an internal set and a public set from one build.
