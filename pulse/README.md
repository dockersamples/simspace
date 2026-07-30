# pulse — presence & analytics for Simspace labs

`pulse` is the **optional** backend for Simspace labs. Labs are static and
server-free; a lab only talks to `pulse` if its `labspace.yaml` declares a
`tracking:` block. One deployment serves many labs (bucketed by `labId`).

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

Then point a lab at it:

```yaml
# labspace.yaml
tracking:
  endpoint: http://localhost:8888
  labId: my-lab          # defaults to the catalog id
  presence: true
  identity: optional-name # anonymous | optional-name
```

## Endpoints

| Method | Path                    | Who        | Purpose |
| ------ | ----------------------- | ---------- | ------- |
| POST   | `/events`               | lab (public) | Ingest one event or a JSON array. Append-only, CORS-open, rate-limited. |
| GET    | `/presence?labId=`      | lab (public) | Live aggregate: `{ total, perSection, perMilestone, avatars }`. |
| GET    | `/completed?labId=`     | catalog (public) | Aggregate-only `{ completed }` count for a lab. |
| GET    | `/stats?labId=`         | instructor | Cumulative funnel / per-step drop-off. Requires `STATS_TOKEN`. |
| GET    | `/healthz`              | ops        | Liveness. |

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
| `CORS_ORIGIN` | `*` | Allowed origin for ingest/presence |
| `MAX_BODY_BYTES` | `65536` | Ingest body cap |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `120` / `60000` | Per-IP ingest limit |
| `STATS_TOKEN` | _(unset)_ | Bearer token for `/stats`; unset → `/stats` disabled |

## Privacy

Events are anonymous: `sessionId`/`actor.id` are random per-browser handles, not
identities. A learner-entered display name is the only optional PII and appears
only if the lab enables `identity: optional-name` and the learner opts in.
Presence is ephemeral (TTL); the durable log stores anonymous events. A lab with
no `tracking:` block sends nothing.

## Verify

```bash
npm run test:smoke     # boots the server on an in-memory DB and exercises every endpoint
```
