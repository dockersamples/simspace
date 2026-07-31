# pulse — presence & analytics for Simspace labs

`pulse` is the **optional** backend for Simspace labs. Labs are static and
server-free; a deployment connects them to `pulse` by pointing the app's
`config.json` at it (one endpoint for the whole deployment, bucketed per lab
and per deployment origin — see [Origin namespacing](#origin-namespacing)).
With no such config the app makes no network calls.

It does two things from one anonymous event stream:

- **Live presence** (shown to learners): who is in a lab right now, and where —
  the "N here now" avatars and per-milestone counts. Ephemeral, in-memory,
  TTL-expired.
- **Cumulative analytics** (instructor-only): completion funnel and per-step
  drop-off. Durable, in SQLite, behind a token. **Never** surfaced beside a step
  inside the running lab — only the catalog "N completed this lab" aggregate is
  public.

## Run it

```bash
# Local (Node 22+)
npm install
npm run dev            # builds + starts on :8888

# Container
docker compose up --build
```

Then point the app at it via `config.json` (served next to `labs.json`). The
repo commits a dev default already pointing here, so `docker compose up` works
out of the box:

```json
// app/public/config.json
{
  "tracking": {
    "endpoint": "http://localhost:8888",
    "presence": true,
    "identity": "optional-name"
  }
}
```

Every lab is then tracked automatically; a lab opts out with `tracking: false`
in its `labspace.yaml` (see `spec/labspace.md` §10.2). In production the deploy
pipeline writes this `config.json` with the real endpoint.

## Endpoints

| Method | Path                    | Who        | Purpose |
| ------ | ----------------------- | ---------- | ------- |
| POST   | `/events`               | lab (public) | Ingest one event or a JSON array. Append-only, CORS-open, rate-limited. |
| GET    | `/presence?labId=`      | lab (public) | Live aggregate: `{ total, perSection, perMilestone, avatars }`. |
| GET    | `/stream?labId=`        | lab (public) | Server-Sent Events: the same aggregate pushed on connect and every ~3s. Clients fall back to `/presence` polling. |
| GET    | `/completed?labId=`     | catalog (public) | Aggregate-only `{ completed }` count for a lab. |
| GET    | `/stats?labId=`         | instructor | Funnel / per-step drop-off. Optional `&sinceMs=<lookback>` scopes counts to a sliding time window (e.g. `10800000` for the last 3h; omit for all-time). Optional `&origin=<origin>` targets another deployment's copy of the lab (default: the caller's own origin). Requires `STATS_TOKEN`. |
| GET    | `/labs`                 | instructor | Inventory of every tracked lab, one row per `(origin, labId)` with `events`/`starts`/`completions`/`firstSeen`/`lastSeen` and the live `hereNow` count, most-recently-active first. Requires `STATS_TOKEN`. |
| GET    | `/healthz`              | ops        | Liveness. |

### Origin namespacing

Lab ids are not globally unique, and one `pulse` endpoint can serve many
deployments, so **all data is namespaced by the request's origin** — taken from
the browser-set `Origin` header (falling back to the `Referer`'s origin, then
`"unknown"` for non-browser callers). The same `labId` served from two sites
never collides, and every stored event records where it came from. This is
transparent to the app: a lab's events, presence, and `/completed`/`/stats`
reads all come from the same origin, so they line up automatically with no
client change. `/labs` surfaces the full `(origin, labId)` inventory, and
`/stats?origin=` lets an operator inspect a specific deployment from anywhere.

## Events

Envelope: `{ labId, labVersion?, sessionId, actor?:{id,name?}, avatar?:{emoji,color}, event, ts?, sectionId?, stepId? }`

`lab_started`, `section_viewed`, `step_completed`, `lab_completed`, `reset`
persist to the durable log **and** update presence. `heartbeat` only refreshes
presence liveness; `leave` only removes a session.

## Configuration (env)

| Var | Default | Purpose |
| --- | ------- | ------- |
| `PORT` | `8888` | HTTP port |
| `DB_PATH` | `./data/pulse.db` | SQLite file (`:memory:` for ephemeral) |
| `PRESENCE_TTL_MS` | `30000` | How long since last heartbeat a session stays "present" |
| `PRESENCE_SAMPLE_SIZE` | `8` | Max avatars returned per presence read |
| `CORS_ORIGIN` | `*` | Allowed origin(s) for ingest/presence. `*` allows any; a single origin or a comma-separated list (e.g. `https://a.example,https://b.example`) is an allowlist — the server reflects a request's `Origin` only if it's on the list and adds `Vary: Origin` |
| `MAX_BODY_BYTES` | `65536` | Ingest body cap |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `120` / `60000` | Per-IP ingest limit |
| `STATS_TOKEN` | _(unset)_ | Bearer token for `/stats`; unset → `/stats` disabled |

## Privacy

Events are anonymous: `sessionId`/`actor.id` are random per-browser handles, not
identities. A learner-entered display name is the only optional PII and appears
only if the lab enables `identity: optional-name` and the learner opts in.
Presence is ephemeral (TTL); the durable log stores anonymous events. With no
`config.json` tracking endpoint (and no per-lab override), the app sends nothing.

## Verify

```bash
npm run test:smoke     # boots the server on an in-memory DB and exercises every endpoint
```
