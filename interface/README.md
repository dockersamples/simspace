# Labspace interface (Go)

A Go reimplementation of the Labspace interface API originally written in Node
(`../interface-node`). The React client is unchanged and copied verbatim from
the Node project; only the backing API has been rewritten in Go.

## Layout

```
interface-go/
├── api/                     # Go API (replaces interface-node/api)
│   ├── main.go              # entrypoint: bootstrap, serve, graceful shutdown
│   └── internal/
│       ├── labspace/        # parses labspace.yaml, renders section content
│       ├── terminal/        # embedded PTY web terminal (mounted at /terminal/)
│       ├── workspace/       # executes commands / saves files via the terminal
│       ├── analytics/       # publishes lifecycle & user-action events
│       ├── server/          # HTTP routes + static asset serving
│       └── version/         # build version constant
└── client/                  # React client (copied from interface-node/client)
```

## HTTP API

All routes are identical to the Node implementation:

| Method | Path                                         | Description                         |
| ------ | -------------------------------------------- | ----------------------------------- |
| GET    | `/api/labspace`                              | Labspace title, sections, services  |
| GET    | `/api/labspace/export`                       | Full content of every section       |
| POST   | `/api/labspace/open-file`                    | Open a file in the IDE              |
| GET    | `/api/labspace/sections/{sectionId}`         | Rendered content for a section      |
| POST   | `/api/labspace/sections/{sectionId}/command` | Run a code block's command          |
| POST   | `/api/labspace/sections/{sectionId}/save-file` | Save a code block to its `save-as` file |
| GET    | `/api/variables`                             | Current variable values             |
| POST   | `/api/variables`                             | Set a variable (`{key, value}`)     |

The embedded terminal is served under `/terminal/` (the xterm UI at `/terminal/`,
its assets under `/terminal/static/`, the PTY WebSocket at `/terminal/ws`, and the
session list at `/terminal/api/sessions`). The client's IDE tab iframes `/terminal/`,
and command/file actions from the instructions panel drive the terminal in-process.

Everything else is served statically: built client assets first, then content
resources from `/labspace/instructions`, falling back to the SPA `index.html`.

## Configuration

The service reads:

- `/labspace/instructions/labspace.yaml` — Labspace definition
- `/etc/labspace-support/metadata/metadata.json` — analytics metadata

| Variable                | Default             | Purpose                                              |
| ----------------------- | ------------------- | ---------------------------------------------------- |
| `PORT`                  | `3030`              | HTTP listen port                                     |
| `PUBLIC_DIR`            | `public`            | Directory containing the built client assets         |
| `TERMINAL_WORKDIR`      | `/labspace/project` | Working directory for terminal shell sessions        |
| `CONTENT_DEV_MODE`      | —                   | Reload `labspace.yaml` on every request when set     |
| `MARLIN_ENDPOINT`       | —                   | Analytics ingestion endpoint                         |
| `MARLIN_API_KEY`        | —                   | Analytics API key (`x-api-key` header)               |

## Development

```bash
cd api
go run .          # runs the API on :3030
go test ./...     # unit tests
```

Run the client dev server separately (`cd client && npm install && npm run dev`);
its Vite proxy forwards `/api` and `/terminal` (including the `/terminal/ws`
WebSocket) to the Go server.

## Build

The multi-stage `Dockerfile` builds the client with Node, compiles a static Go
binary, and assembles a minimal runtime image:

```bash
docker build -t labspace-interface-go .
```
