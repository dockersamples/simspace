# Design: Live Presence & Progress Tracking for Simspace Labs

**Status:** Design (decided) · **Audience:** Simspace maintainers · **Date:** 2026-07-30

This is the **decided design** that follows the research in
[`Design Research_ Progress & Completion Tracking for Simspace Labs.md`](./Design%20Research_%20Progress%20%26%20Completion%20Tracking%20for%20Simspace%20Labs.md).
Read that first for the verified engine baseline (§0) and the analysis behind the
completion-signal choice. This document records **what we're building and why**,
reflecting the maintainer decisions taken during design review, and adds the
piece the research doc did not cover: **live presence** ("who's here right now").

The YAML-format additions described here (`sections[].steps[]`, `completes:`,
`tracking:`) will fold into [`spec/labspace.md`](./spec/labspace.md) and
[`spec/simulator.md`](./spec/simulator.md) when implemented; this doc is the
design of record until then.

---

## 1. Decisions taken in review

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Completion signal = the research doc's `completes:` model.** A "step" is an author-defined checkpoint; "done" = a scenario tagged `completes: <step-id>` fired. Steps are cataloged per-section in `labspace.yaml`. | Reuses the already-surfaced matched-scenario id (research doc B1/B2); strong "did it" signal; one line per step to author. |
| D2 | **In-lab, learners see LIVE PRESENCE ONLY — never cumulative counts.** At a milestone: "how many are here *now*," not "how many have *ever* completed this." | A cumulative per-step number reads as drop-off ("only 3 of 500 got here") and can *cause* the drop-off it reports. Live presence is a positive, "you're not alone" signal. **This is the load-bearing principle of the whole design.** |
| D3 | **Cumulative completion is for the catalog page and instructor analytics — outside the live lab.** Catalog: "N completed this lab." Analytics dashboard: full funnel / per-step drop-off, instructor-only. | Full reporting still matters — just not in the learner's face mid-lab. |
| D4 | **Identity: anonymous by default, optional self-chosen display name.** Deterministic avatar (color + emoji) from a random `sessionId`; a name is explicit opt-in with a presence disclosure. | Lab is anonymous today; keep it that way by default. A name is PII and presence broadcasts location, so gate it on consent. |
| D5 | **One unified backend for presence + analytics**, self-hostable, in a new `pulse/` directory in this repo, **Node/TypeScript**. One deployment serves many labs (keyed by `labId`). | Both surfaces derive from one event stream — one ingest pipeline, not two. In-repo Node/TS shares tooling with `app/`. |

---

## 2. Core principle: in-lab is live and positive

Everything downstream follows from **D2**. The system produces two very
different kinds of number, and they must never be confused:

- **Presence** — *ephemeral, live, shown to learners.* "3 people are at this
  milestone right now." Goes to zero overnight and that's fine; it's a heartbeat,
  not a scoreboard. Only ever framed positively.
- **Completion** — *durable, cumulative, shown to instructors (and, aggregated,
  on the catalog page).* "142 people have completed this lab; 60% reach step 4."
  This is the drop-off data — valuable for authors, **never surfaced beside a
  step inside the running lab.**

Both are computed from the **same event stream** (§4). The difference is purely
*which store answers which question* and *who is allowed to see it*.

### 2.1 Surface map

| Surface | Number shown | Source | Audience |
|---------|--------------|--------|----------|
| **Lab header** | "N here now" + avatar stack (whole lab) | presence (live) | learner |
| **Section nav / progress** | live dot on sections others occupy | presence (live) | learner |
| **At a milestone (step)** | "🧑 N here" — sessions whose progress is this milestone | presence (live) | learner |
| **Learner's own progress** | their check-marks / resume point | local `simspace:progress:<labId>` | learner (self) |
| **Catalog / landing page** | "N completed this lab" (aggregate per lab) | completion (cumulative) | anyone browsing |
| **Instructor dashboard** | funnel, per-step drop-off, time-on-step | completion (cumulative) | instructor |

---

## 3. Presence semantics

### 3.1 "Milestone position" — where an avatar sits

A session's **milestone position** is its **last completed step** (the furthest
`completes:` it has fired), or a synthetic `start` before any step. Live avatars
cluster at the milestone each session has most recently reached — like runners
spread along a course. As learners progress, avatars visibly move from one
milestone to the next. This is the "watch the pack move" feel, and it never
requires showing a discouraging total.

A session also has a **reading position** (the section it is currently viewing,
from `section_viewed`). Reading position drives the header "N here now" and the
nav dots; milestone position drives the per-milestone avatar clusters. They can
differ (someone re-reading an earlier section while their progress is further on)
— that's fine and even useful.

### 3.2 "Active" window

A session is **present** if it has sent a heartbeat within the last **~30s**
(heartbeat interval ~15s, so one miss tolerated). Presence is derived, not
stored as truth: expire on TTL. On page unload, a best-effort `leave` beacon
removes the session immediately so counts feel responsive.

### 3.3 Avatars & identity (D4)

- Default: a deterministic avatar generated from `sessionId` — a color + a
  Material Symbol / emoji. Stable within a session, meaningless across sessions,
  no PII.
- Optional: the learner sets a **display name** (and maybe picks an emoji). This
  is explicit opt-in. Because turning it on both attaches PII *and* means "others
  can see you're here," the opt-in carries a one-line disclosure and is
  remembered in `localStorage`. Anonymous mode needs no consent.
- The presence read endpoint returns only a **bounded sample** of avatars (e.g.
  up to 5 + "and N more") to cap payload and avoid implying precise surveillance.

### 3.4 What is never shown to a learner

Per D2: no cumulative "X completed this step," no per-step conversion rate, no
"you are behind," no negative or comparative framing. If presence at a milestone
is zero, show nothing (or a neutral "be the first here today"), never "0 of N."

---

## 4. Unified event model

The client emits a small set of events. The backend routes each to the presence
store (ephemeral, TTL) and/or the durable event log.

```
Envelope (every event):
  { labId, labVersion, sessionId, actor: { id, name? }, event, ts, ...payload }

Events:
  lab_started                              → durable; funnel start
  section_viewed   { sectionId }           → durable (funnel) + presence reading-position
  step_completed   { stepId, sectionId }   → durable (completion) + presence milestone-position
  lab_completed                            → durable; funnel end
  reset                                    → durable; frustration signal
  heartbeat        { sectionId }           → presence TTL refresh only (NOT persisted)
  leave                                    → presence removal (best-effort, sendBeacon on unload)
```

- **Transport:** `navigator.sendBeacon(endpoint, blob)` for fire-and-forget,
  falling back to `fetch(..., { keepalive: true })` where a response is needed
  (research doc §3.2). Events may be batched.
- **The endpoint is public** (it ships in static JS), so ingest is **append-only,
  unauthenticated, CORS-open, and rate-limited by origin/IP**. No secret in the
  client, ever.
- **Anonymous by default:** `actor.id` is a random per-session handle, not an
  identity. `actor.name` is present only if the learner opted in (D4).

Presence and completion are thus **two projections of one stream**: presence is
"the last-seen state of currently-active sessions"; completion is "the durable
count of `step_completed` / `lab_completed` over all time."

---

## 5. The `pulse` service

A single self-hostable container (working name **`pulse`** — placeholder), new
directory `pulse/` in this repo, Node/TypeScript.

### 5.1 Endpoints

| Method / Path | Purpose | Store | Auth |
|---|---|---|---|
| `POST /events` | Ingest one or a batch of events | durable + presence | none (public, rate-limited) |
| `GET /presence?labId=` | Live aggregate: `{ total, perSection:{}, perMilestone:{}, avatars:[sample] }` | presence | none |
| `GET /stats?labId=` | Cumulative: per-step completion, section funnel, drop-off, lab-completion count | durable | instructor (token) |
| `GET /stream?labId=` | *(Phase 5)* SSE push of presence aggregates | presence | none |

- `GET /stats` is the only read that exposes drop-off, so it is **gated**
  (instructor token / basic auth) and never called by the lab UI. The catalog
  page uses a narrow, public, **aggregate-only** slice ("N completed this lab")
  — a single number per lab, not per-step.
- **Multi-lab:** every request carries `labId`; one deployment backs many labs.

### 5.2 Storage

- **Durable event log: SQLite by default.** Zero-dependency, single file, single
  container — an author can `docker run` the whole thing next to their lab
  locally. Optional Postgres for larger, shared deployments.
- **Presence: in-memory by default** (a map of `sessionId → {labId, sectionId,
  milestone, avatar, lastSeen}` with TTL sweep). Optional **Redis** (with key
  TTL) when running multiple service replicas.
- Rollups/counters for `/stats` and the catalog number are computed from the
  event log (materialized incrementally if needed).

### 5.3 Privacy & security

- No PII unless a learner opts into a name; even then it's a self-chosen display
  string, not verified identity.
- Presence data is ephemeral (TTL); the durable log stores anonymous events.
- CORS open for ingest and presence reads (static lab is a different origin);
  `/stats` gated. Rate-limit ingest per origin/IP.
- A lab with no `tracking:` block sends **nothing, ever** — the feature is
  entirely opt-in and additive (matches the project's static/server-free ethos).

---

## 6. Client integration (the static app stays static)

### 6.1 Config — new optional `labspace.yaml` block

Absent → zero network, byte-identical to today.

```yaml
tracking:
  endpoint: https://pulse.example.com   # the pulse service (omit → feature off)
  labId: docker-basics                  # bucket key on a shared backend (default: catalog id)
  presence: true                        # show live avatars/counts (default: on when endpoint set)
  identity: optional-name               # anonymous | optional-name  (default: optional-name)
```

### 6.2 Completion foundation (from the research doc, §1 & §5.4)

Prerequisite for any step-level data — local and live alike:

- `labspace.yaml`: `sections[].steps[]` catalog (`{ id, title }`).
- `simulator.yaml`: `completes: <step-id>` on the scenario that means "did it."
- Engine 3-touch change surfacing `completes` on `CommandOutcome`
  (`manifest.ts` → `run.ts` → `simulator.ts` + `types.ts`).
- `validate-lab` guardrail: dangling `completes:` (unknown step) and unreachable
  steps (cataloged but no scenario completes them).
- Local **progress store** `simspace:progress:<labId>`, separate from the
  reset-able engine state (research doc B5) — powers the learner's own
  check-marks and resume, and is the source of `step_completed` events.

### 6.3 `TrackingContext` (new)

A React context wired at the `TerminalPanel.handleChange` / `MockTerminal`-after-
`execute()` seam (research doc B6). Responsibilities:

- Own `sessionId` + avatar identity (and optional name + consent flag).
- On `outcome.completes`: mark the step in the local progress store, advance
  milestone position, emit `step_completed`.
- Emit `lab_started` / `section_viewed` / `lab_completed` / `reset`.
- Send `heartbeat` every ~15s while the tab is visible; `leave` on unload.
- Poll `GET /presence` (~10s) and expose `{ total, perSection, perMilestone,
  avatars }` to the UI. No-op entirely when `tracking.endpoint` is unset.

Keep the **engine pure** — it only *reports* `completes`; all persistence,
network egress, and presence live in the app layer (research doc §5.2).

### 6.4 Render points

- `WorkshopHeader` — avatar stack + "N here now" beside the existing `N / total`.
- `WorkshopNav` + progress segments — live dot on sections others occupy.
- At each step in section markdown — "🧑 N here" cluster at the milestone
  (live only, per D2).
- Catalog / `Home` — "N completed this lab" (aggregate, cumulative, per D3).

---

## 7. Open questions carried from the research doc

Resolved by this design:

- **O1 (Reset & progress):** progress **survives** exercise Reset; a separate
  explicit "Reset progress" action. ✔
- **O3 (step catalog location):** `labspace.yaml` owns the catalog; scenarios
  reference ids via `completes:`; `validate-lab` checks the cross-file link. ✔
- **O8 (analytics vs presence):** unified — one stream, two projections. ✔

Still to resolve before/while implementing:

- **O2 — `labVersion`.** `labspace.yaml` has no version field today. The progress
  key and durable events want one to invalidate/migrate when a lab's steps
  change. Decide where it lives (new `labspace.yaml` field) and the invalidation
  policy.
- **O6 — consent line.** Confirm anonymous `sessionId` is not "personal data" in
  target jurisdictions so anonymous mode needs no banner; the name opt-in always
  carries the presence disclosure.
- **O9 — "lab complete" definition.** All steps, or a `required: true` subset?
  Affects the catalog "N completed this lab" count and `lab_completed`.
- **Naming.** `pulse`, `tracking`, config block name — all placeholders.

---

## 8. Phasing

1. **Foundation (local, no backend).** `completes:` end-to-end (engine → outcome
   → local progress store), `sections[].steps[]` parsing, learner's own
   check-marks + resume, `validate-lab` guardrail. *Delivers visible value with
   zero external dependencies.*
2. **`pulse` service.** Node/TS ingest (`POST /events`) + SQLite durable log +
   in-memory presence + `GET /presence`, containerized in `pulse/`. CORS, rate
   limiting, `labId` bucketing.
3. **Live presence in-lab.** `TrackingContext`, heartbeats, header avatar stack +
   "N here now" (polling).
4. **Per-milestone live counts.** Avatar clusters at steps + nav dots (live only).
5. **Analytics & catalog.** Instructor `/stats` dashboard (funnel/drop-off,
   gated), catalog "N completed this lab", and SSE `/stream` for smoother live
   updates.

Phases 1–2 are detailed in the implementation plan that accompanies this design.
