# Design Research: Progress & Completion Tracking for Simspace Labs

**Status:** Draft for review · **Audience:** Simspace maintainers · **Date:** 2026-07-29

## Purpose

Simspace labs are fully static, server-free, in-browser learning runtimes: a
learner types commands into a mock terminal, and a deterministic in-memory state
machine (`simulator.yaml`) produces the same output every time. Today there is no
notion of *progress* — nothing records "the learner completed step X," and nothing
aggregates usage across learners.

This document researches how to add two dimensions of tracking without breaking the
project's core principles (**static, server-free, deterministic, lab-as-data,
authoring simplicity**):

1. **Individual** — how far did a specific learner get?
2. **Collective** — aggregate usage across learners (drop-off, popular paths).

It ends with a single recommended approach, concrete YAML/markdown, and open
questions to resolve before implementation.

---

## How to read this document

- **§0 Verified baseline** — facts confirmed by reading the code/specs this session.
  Everything else builds on these.
- **§1** the completion *signal* (what "done" means and how it is declared).
- **§2** individual tracking (in-browser first).
- **§3** collective telemetry (options under the static constraint).
- **§4** the scenario ↔ instruction split (the open architectural question).
- **§5** the recommendation, with worked YAML/markdown.
- **§6** options summary table.
- **§7** open questions.

---

## 0. Verified baseline (facts, not assumptions)

These were confirmed against `spec/simulator.md`, `spec/labspace.md`, and the engine
under `app/src/` during this research. They are the load-bearing constraints; the
design leans directly on them.

| # | Fact | Source | Why it matters |
|---|------|--------|----------------|
| B1 | Every command run returns `CommandOutcome.matched` = the **id of the scenario that fired** (`""` if unmatched, `"__builtin__"` for `ls`/`cat`). | `engine/run.ts` sets `matched = m.scenario.id`; `engine/simulator.ts` `execute()` propagates it. | The "which scenario fired" signal **already reaches the UI**. No new engine plumbing is needed to know a step's triggering scenario succeeded. |
| B2 | Scenarios carry a stable, unique `id` (auto-filled `scenario-<index>` if omitted). | `spec/simulator.md` §5; `engine/manifest.ts` `normalizeScenario`. | A scenario is already addressable — the natural anchor for a completion tag. |
| B3 | `normalizeScenario` builds the scenario object from **only** `{id, description, when, then}` — **unknown top-level fields are silently dropped**. | `engine/manifest.ts`. | Adding `completes:` to a scenario requires a **one-line** change to preserve it through parsing. |
| B4 | State + virtual FS are already **persisted to `localStorage`** today: `simspace:engine` (state+files), `simspace:terminal:<id>` (transcripts), `simspace:variables`. Owned by `TerminalContext.jsx`. | `app/src/context/TerminalContext.jsx`, `terminal/MockTerminal.tsx`. | Individual progress is an **extension of an existing pattern**, not new infrastructure. |
| B5 | The reserved `history` key stores **raw command lines only** (no scenario id/exit), lives **inside the state tree**, and is **cleared by Reset**. | `spec/simulator.md` §2; `engine/state.ts` `appendHistory`; `run.ts` appends before matching. | History-replay can reconstruct completion, but only if replayed through the engine; and progress must live **outside** the reset-able state tree to survive Reset. |
| B6 | The engine (`Simulator`) is **pure request/response** — no events, no observers. The pub/sub layer (`subscribe`/`broadcast`, events `{type:"state"}`/`{type:"reset"}`) lives in `TerminalContext.jsx`; the natural "after each command" seam is `handleChange` in `TerminalPanel.jsx` (and `MockTerminal.runCommand` right after `execute()`). | `app/src/context/TerminalContext.jsx`, `components/.../TerminalPanel.jsx`. | The completion/telemetry hook belongs in the **app layer**, keeping the engine deterministic and side-effect-free. |
| B7 | Fence meta (`terminal-id=`, `save-as=`, `highlight=`, `no-run-button`) is parsed in `components/WorkshopPanel/markdown/codeIndexer.js` into `data-*` attributes read by `CodeBlock.jsx`. Adding a `step=` token is a one-line change. | `codeIndexer.js`, `CodeBlock.jsx`. | Markdown-side tagging is cheap, but see B8. |
| B8 | Sections get a stable id = `slugify(title)`, routed at `/:sectionId`, with a tracked `activeSectionId`. **Individual code blocks have no stable id** (only an unstable per-render `data-code-index`). | `labspace/loader.js`, `WorkshopContext.jsx`, `codeIndexer.js`. | Section slug is the finest **stable** grain today. Code-block-level identity would have to be author-assigned. |

**Two consequences flow from this baseline:**

- The cleanest completion signal is *"a scenario tagged with a step id fired"* —
  because the matched scenario id (B1) is already surfaced, scenarios are already
  identified (B2), and success is already determined by the scenario/state model.
- Progress data must live in a **separate store from the exercise state tree** (B5),
  so pressing **Reset** (which re-seeds exercise state and clears `history`) does not
  wipe the learner's completion record.

---

## 1. The completion signal: knowing "step X is done"

### 1.1 What is a "step"?

Candidate granularities, from coarse to fine:

| Grain | Stable id today? | "Done" means | Verdict |
|-------|------------------|--------------|---------|
| **Section** | Yes (`slugify(title)`, B8) | Learner navigated to / viewed the page | Too weak on its own — *viewing* ≠ *doing*. Good as a **derived, rollup** signal and for nav check-marks. |
| **Code block** | No (unstable index, B8) | Learner clicked its Run button | Needs an author-assigned id; and *typing* a command ≠ it *working*. |
| **Scenario** | Yes (`id`, B2) | A specific scenario **fired** (i.e. the command actually did the meaningful thing) | **Best signal.** Firing is gated on state, so it means the learner reached the right situation and ran the right command. Already surfaced (B1). |
| **State transition** | n/a | A state predicate became true (e.g. `container.running == true`) | Most semantically precise and order-independent, but adds a second evaluation concept and more authoring surface. Good **optional advanced** form. |

**Recommendation: a "step" is an author-defined checkpoint whose completion signal is
"a scenario tagged with that step's id fired."** Sections become a *rollup* (a section
is complete when all its steps are), giving a clean two-level hierarchy:
**sections (nav/progress UI) → steps (the actual signals)**. This matches how the
engine already determines success and reuses the already-surfaced matched-id (B1).

Informational sections (no commands to run) simply declare **no steps** and count as
complete on view — a weaker but honest signal, kept separate from the scenario-backed
signal.

### 1.2 Declaring the mapping — the Run → scenario → step chain

The user framed the core problem precisely: *a Run button types a command → the
command fires a scenario → that scenario's success means the step is complete.* The
question is **where the mapping between "scenario" and "step" is declared.**

Three places the tag could live:

1. **On the scenario** (`simulator.yaml`): `completes: <step-id>`. The scenario is the
   authority on success, so this is where completion is *truthfully* known. **(Chosen.)**
2. **On the code block** (markdown fence): `step=<step-id>`. Convenient, but a block
   only *types text*; whether it succeeds is still decided by whichever scenario fires.
   Block tagging alone cannot know success, so it can at best mean "a non-unmatched
   scenario fired for this block." Useful as an **optional convenience** that pairs a
   block with a step for UI affordances, not as the source of truth.
3. **On a step predicate** (a step catalog entry with a `when:` state condition). The
   flexible advanced form; deferred.

**Chosen wiring — tag the scenario, catalog the steps in the labspace:**

- `labspace.yaml` owns the **step catalog** (presentation: what appears in the progress
  UI, grouped by section) — consistent with `labspace.yaml` owning everything the
  learner *reads*.
- `simulator.yaml` scenarios reference step ids via **`completes:`** (behaviour: *when*
  a step is done) — consistent with `simulator.yaml` owning command *behaviour*.

This yields an **explicit, lint-checkable mapping** across the two files without
restructuring either. `validate-lab` already checks cross-file references and is the
natural place to flag a dangling `completes:` (a scenario referencing an unknown step)
or an *unreachable* step (a catalog entry no scenario completes).

### 1.3 Minimum authoring burden

To make an existing lab track progress, an author adds:

1. A **step catalog** under the relevant section(s) in `labspace.yaml` (id + title).
2. One **`completes: <step-id>`** line on the scenario that represents "the learner
   did it."

Nothing else. No new markdown, no restructuring, no change to how output is scripted.
A lab that adds *no* steps behaves exactly as today (feature is opt-in and additive).

### 1.4 How the engine reports it (tight wiring)

Because the matched scenario object is in hand at match time and the matched id
already flows out (B1), surfacing completion is a three-touch change plus an app hook:

1. **`manifest.ts`** — preserve the new field: `normalizeScenario` returns
   `{ id, description, completes, when, then }` (B3 one-liner).
2. **`run.ts`** — on a hit, set `result.completes = m.scenario.completes` (the object is
   already resolved there).
3. **`simulator.ts`** — propagate `completes` onto `CommandOutcome`.
4. **App hook** (`TerminalPanel.handleChange` / `MockTerminal` after `execute()`, B6) —
   if `outcome.completes` is set, mark that step done in the **progress store** (§2) and
   emit a telemetry event (§3).

The engine stays pure: it merely *reports* which step a command completed. All
recording, persistence, and any network egress happen in the app layer, where
`localStorage` already lives (B4/B6). Determinism is untouched — completion is a pure
function of `(state, command)`, exactly like the scenario match itself.

> **Idempotency:** marking a step already completed is a no-op. Re-running the same
> command re-fires the scenario and re-asserts completion harmlessly.

---

## 2. Individual progress tracking (in-browser first)

All four approaches below are server-free. They are **complementary**, not exclusive:
localStorage is the primary store; export and URL are portability layers on top;
history-replay is a verification property of the data model.

### 2.1 localStorage persistence (primary)

The app already persists engine state to `localStorage` (B4), so this is the idiomatic
choice. Add a **dedicated progress store**, keyed and namespaced separately so it can
outlive the exercise Reset:

```
Key:   simspace:progress:<labId>
Value: {
  labId: "docker-basics",
  labVersion: "1.2.0",           // invalidate/migrate when the lab changes
  actor: { name?: string, id: string },   // id = random uuid; name optional, self-entered
  startedAt: "2026-07-29T10:00:00Z",
  lastActiveAt: "2026-07-29T10:14:22Z",
  completed: {
    "pull-image":   { at: "...T10:03Z", command: "docker pull nginx", scenario: "pull-nginx" },
    "run-container":{ at: "...T10:07Z", command: "docker run -d nginx", scenario: "run-container" }
  }
}
```

**What to store:** the set of completed step ids with a timestamp and the triggering
command/scenario (useful for reports and debugging), plus lightweight session metadata.
Do **not** store the full exercise state here — that already lives under `simspace:engine`
and is intentionally reset-able. Keep the two concerns separate.

**Key scheme:** namespace by `labId` (from `simulator.yaml` `metadata.id`) so multiple
labs on one origin don't collide, and include `labVersion` so progress can be
invalidated or migrated when the lab's steps change (see Open Question O2 — labspace
has no version field today).

**Restore on reload:** on load, hydrate the progress store → render check-marks in the
section nav, a progress bar, and a "resume where you left off" affordance (jump to the
first section with incomplete steps).

**Reset semantics (important):** the exercise **Reset** button re-seeds state + FS and
clears `history` (B5). Progress should **survive** that — a learner resetting the
sandbox to retry should not lose their completion record. Provide a *separate*,
explicit "Reset progress" action. (This is Open Question O1.)

**Privacy:** everything is local to the browser; no network, no PII unless the learner
chooses to type a name. The random `actor.id` is a per-browser handle, not an identity.
Clearing site data clears progress — acceptable and expected for a static app.

### 2.2 URL / hash state (shareable resume link)

Progress can be encoded in the URL fragment so it is bookmarkable and shareable
("here's my progress") without any storage:

```
https://host/labs/docker/#/run-a-container?done=pull-image,run-container
```

or, compactly, a base64 bitmask over the ordered step catalog (`?p=Bw`).

- **Pros:** works with storage disabled (private browsing), trivially shareable, good
  for an instructor collecting "paste your link" evidence, survives across devices.
- **Cons/trade-offs:** URLs get long and ugly; fragment size is bounded; the app
  **already uses hash routing** (`/:sectionId`), so progress must ride in a query
  portion of the fragment and be parsed carefully to avoid clobbering the route; and
  the value is trivially forgeable (fine — it is self-reported evidence, not a
  security boundary).
- **Verdict:** offer as an **export/resume link**, not the primary store. Generated on
  demand ("Copy progress link"), consumed on load to seed the localStorage store.

### 2.3 Export / download (the LMS bridge without a backend)

A **"Download completion report"** button serializes the progress store to a file the
learner hands to an instructor or uploads to an LMS. This is the key server-free path
to get data *out*.

Offer two shapes from the same data:

- **JSON** (native) — the progress-store object above, plus a `history` snapshot and a
  computed summary (`completed/total`, percentage).
- **CSV** (spreadsheet-friendly) — one row per step: `labId, stepId, sectionId, completed, at`.

**Make the JSON xAPI-statement-shaped** so it is LRS-importable later without
committing the static app to any LRS auth (see §3.4). A `step_completed` becomes a
statement with `verb: completed`, `object: <step activity IRI>`, `actor: <account>`,
`result.completion: true`, and a `timestamp`. The report is then simultaneously a
human artifact and a machine-ingestible xAPI batch.

### 2.4 History-replay reconstruction (a property of lab-as-data)

Because the lab is pure data and the engine is deterministic, **replaying the recorded
command `history` from the seed state re-fires the same scenarios and re-derives the
same completion set.** This is a genuine and useful property:

- **Reconstruct** progress from just a saved command log (e.g. an exported `history`).
- **Verify** a completion report is authentic: re-run the commands headlessly and check
  the same steps light up (the engine already runs outside React — `validate-lab` uses
  it via `scripts/run-ts.mjs`).

**Caveats to flag:** `history` today stores **raw lines only** and is **cleared on
Reset** (B5); it does **not** capture `controls`/toggle changes or the timing needed to
reproduce a non-default control position, so a replay assumes default control state
unless those are also recorded. To make replay/reporting robust, optionally **enrich
history entries** into structured records (`{ line, terminal, matched, completes, exit }`)
and record control flips — but that changes the reserved `history` shape and is a spec
change (Open Question O5). For v1, treat replay as a *bonus verification path*, not the
primary store.

---

## 3. Collective telemetry (options under the static constraint)

The hard constraint: **no backend ships with the app.** Any aggregate collection
therefore requires either (a) the learner to move data manually, (b) an *external*
sink the author configures and hosts, or (c) a third-party analytics service. All
collective options are **opt-in and config-driven** — a lab with no telemetry config
sends nothing, ever.

### 3.1 No backend at all — self-report (download + submit)

The learner downloads the completion report (§2.3) and submits it through whatever
channel the instructor uses (email, a form, an LMS upload). Aggregation is manual or a
small offline script.

- **Feasibility:** trivial to build (reuses the export), zero infra, maximal privacy.
- **Reality:** low collection rate and high friction; no automatic aggregation; only
  works for cohorts with a submission channel (a classroom, not the open web).
- **Role:** the honest floor — always available, and the only option that needs *nothing*
  external. Good default for instructor-led settings.

### 3.2 Lightweight external sink — configurable beacon (recommended for opt-in collection)

Add an optional telemetry block to `labspace.yaml`; when present, the app fires
fire-and-forget events to an **author-provided** endpoint:

```yaml
telemetry:
  endpoint: https://collect.example.com/labs   # author-hosted sink (serverless fn, collector, etc.)
  events: [lab_started, section_viewed, step_completed, lab_completed, reset]
  consent: required        # required | implied  (see privacy note)
  sampleRate: 1.0          # optional client-side sampling
```

**Transport:** `navigator.sendBeacon(endpoint, blob)` — purpose-built for fire-and-forget
telemetry, delivers even on page unload, but is capped at ~64 KB and sends a
simple/CORS-safe content type (no custom headers). Fall back to
`fetch(endpoint, { method: 'POST', keepalive: true, ... })` when a JSON content type or
response is needed. (Sources: MDN `navigator.sendBeacon`.)

**Event payload (anonymous):**

```json
{
  "labId": "docker-basics",
  "labVersion": "1.2.0",
  "sessionId": "e2b1...",        // random per-session; NOT an identity
  "event": "step_completed",
  "stepId": "run-container",
  "sectionId": "run-a-container",
  "ts": "2026-07-29T10:07:00Z"
}
```

**What events buy you:** `lab_started` / `lab_completed` (funnel ends), `section_viewed`
(navigation funnel), `step_completed` (the meaningful signal — drop-off *by step*),
`reset` (frustration signal). With an anonymous `sessionId` you can reconstruct
**within-session ordering and drop-off** server-side, which pure page analytics cannot.

**CORS:** a cross-origin POST from a static site needs the endpoint to return
`Access-Control-Allow-Origin`. `sendBeacon` issues a simple request (no preflight) for
CORS-safe content types.

**Credential exposure:** the endpoint URL is public (it ships in static JS), so the sink
must be **append-only and unauthenticated** — accept anonymous events, rate-limit by
origin/IP, never require a secret in the client. Do not embed any key.

**Privacy / consent:** if events are truly anonymous (random session id, no self-entered
name), the data is arguably not personal data and can default to `implied`; the moment
any PII (a learner name/email) is attached, `consent: required` must gate sending behind
an explicit opt-in (stored in `localStorage`). Ship a consent affordance and honour it.

**Role:** the recommended path when an author actively wants aggregate data while
keeping the app static — the sink is external, swappable, and entirely opt-in.

### 3.3 GitHub Pages + cookieless web analytics (lowest effort)

Many labs deploy to GitHub Pages, so drop-in analytics is essentially free. Cookieless,
GDPR-friendly providers (**Plausible**, **GoatCounter**, **Cloudflare Web Analytics**)
need no consent banner; **GoatCounter** is free and self-hostable, **Cloudflare** is free
if already fronted by CF, **Plausible/Fathom** are paid-hosted (Fathom Lite / Plausible
are self-hostable). **GA4** can do custom events but uses cookies → consent banner.

They capture **custom events**, not just pageviews, from client JS — fired at the *same*
completion hook (B6):

```js
// Plausible custom event
window.plausible('step_completed', { props: { step: 'run-container', section: 'run-a-container' } });

// GoatCounter custom event
window.goatcounter.count({ path: 'step-run-container', title: 'step completed', event: true });
```

**What you CAN infer:** aggregate section funnel and drop-off, most/least reached
sections, per-step completion counts, rough time-on-page and popular entry points. Since
routing is per-section, section navigation shows up as page/route views (needs SPA/hash
tracking mode, e.g. Plausible manual/hash-based pageviews).

**What you CANNOT infer:** per-learner paths or cross-session identity — cookieless is
*anonymous by design*, so "learner who took branch A dropped at step 4" is not
recoverable; only aggregate conversion between steps is. Also expect **ad-blocker loss**
(~10–40% of traffic) and, on some tiers, sampling. GoatCounter's standard event API
carries no custom properties (encode context into the event `path`/`title`).

**Role:** the **lowest-effort collective signal** — add a snippet + fire one custom event
per step. Great for "are people finishing?" dashboards; insufficient for per-learner
funnels.

### 3.4 LMS standards — SCORM / xAPI / LTI

Researched against the specs (ADL xAPI, 1EdTech LTI 1.3, SCORM RTE). Verdicts for a
**standalone static app**:

| Standard | Fits a standalone static app? | Why |
|----------|-------------------------------|-----|
| **SCORM** | **No** | The content must call an LMS-injected JS API object (`window.API` / `API_1484_11`) found by walking the parent-frame hierarchy. A standalone static site has no such parent. **Only** works when the lab is packaged as a SCORM zip and *uploaded into an LMS* that provides the API at runtime. |
| **LTI 1.3 / Advantage** | **No (backend required)** | Requires server-side OIDC login, JWT signature validation against the platform JWKS, OAuth2 token requests, and Assignment & Grade Services. None can be done from a purely static SPA. Would need a small backend tool — out of scope for "static." |
| **xAPI (Tin Can)** | **Partial** | A browser *can* CORS-POST statements to an LRS, but the LRS requires Basic/OAuth auth — embedding that credential in static JS exposes it. So *direct-to-LRS* is discouraged. |

**The pragmatic xAPI play (no LRS auth in the client):** shape the telemetry/export
payloads as **xAPI statements** and send them to the same **anonymous author endpoint**
(§3.2) or **download them as a file** (§2.3) for later LRS import. This yields a
standards-aligned, LRS-ready record **without** putting LRS credentials in a public
static bundle. A minimal `step_completed` statement:

```json
{
  "actor": { "objectType": "Agent", "account": { "homePage": "https://simspace.local", "name": "e2b1..." } },
  "verb":  { "id": "http://adlnet.gov/expapi/verbs/completed", "display": { "en-US": "completed" } },
  "object": { "id": "https://simspace.local/labs/docker-basics/steps/run-container",
              "definition": { "name": { "en-US": "Start the nginx container" } } },
  "result": { "completion": true },
  "timestamp": "2026-07-29T10:07:00Z"
}
```

Useful ADL verbs: `attempted` (started a step), `completed` (finished), `passed`
(finished a graded checkpoint), `progressed` (partial). A lightweight client library
(TinCanJS, ~40 KB) exists if direct-LRS is ever wanted, but is unnecessary for the
endpoint/file approach.

**Role:** treat SCORM-zip packaging and xAPI-file export as **LMS bridges** (build-time
or download-time), not runtime integrations. LTI is out unless a backend is later added.

---

## 4. Rethinking the scenario ↔ instruction split

The user is open to changing how `simulator.yaml` and section markdown divide
responsibility if it makes completion tracking easier. Four models, evaluated against
the project principles and the completion goal:

### 4.1 Current model — simulator owns output, markdown is instructional

- **How:** `simulator.yaml` scripts all command behaviour/output; markdown only teaches
  and provides Run buttons.
- **Strengths:** clean separation of concerns; deterministic, state-gated output;
  scenarios reusable across sections; the whole product value (shared state,
  cross-terminal, controls, CI, agent sessions, re-run) lives here.
- **Gap for tracking:** the step ↔ scenario mapping is *implicit* — nothing declares
  "this scenario means step X is done."

### 4.2 Hybrid / checkpoint-validation — markdown declares expected outcome, engine validates

- **How:** checkpoint steps declare their expected result in markdown/labspace; the
  engine validates the learner's actual result against it, making markdown the source of
  truth for "what success looks like."
- **Assessment:** the scenario **already** encodes success (via the state it sets and the
  fact that it fired). Declaring expected output a *second* time in markdown **duplicates**
  that logic, invites drift between the two, and adds a parallel evaluation path. It buys
  little the `completes:` tag doesn't, at higher cost. **Reject** as the general model.

### 4.3 Embedded-output — move scripted output into the markdown (drop the state engine for some steps)

- **How (the user's idea):** for some steps, the terminal output lives in the markdown
  block itself; the state machine is bypassed. "Completion" becomes "ran this block."
- **Gained:** dead-simple authoring for purely linear "type this, see exactly that"
  snippets; the block is self-contained; completion is trivially "the block ran."
- **Lost (substantial):**
  - **Determinism-by-state** — output can no longer reflect state, so `docker ps` after
    `docker run` cannot differ from before; gating and error branches vanish.
  - **The shared model** — cross-terminal visibility, `controls`, CI runs, agent
    sessions, and CI **re-run** all depend on the state machine.
  - **Signal quality** — completion degrades from "did the thing" to "typed the block,"
    which is exactly the weak signal §1 set out to avoid.
- **Assessment:** this trades the product's core engine for marginal authoring
  simplicity, and *weakens* tracking rather than helping it. It only ever suits
  cosmetic, non-stateful snippets — which the engine already handles trivially. **Reject**
  as a general model; if desired at all, keep it to clearly non-interactive display
  blocks, not tracked steps.

### 4.4 Scenario-tagging — keep the split, add lightweight tags

- **How:** keep `simulator.yaml` and markdown exactly as they are; add an optional
  `completes:` tag on scenarios and a step catalog in `labspace.yaml` (§1.2).
- **Assessment:** preserves the clean split and the entire engine value, adds an
  **explicit, lint-checkable** step↔scenario mapping, imposes minimal authoring burden
  (one line per tracked step), needs no new evaluation path, and leverages the
  already-surfaced matched id (B1). **This is the winner.**

### 4.5 Verdict

| Model | Authoring simplicity | Keeps engine value | Tracking quality | Determinism | Verdict |
|-------|:---:|:---:|:---:|:---:|:---:|
| 4.1 Current | ◑ | ✓ | ✗ (implicit) | ✓ | Baseline |
| 4.2 Hybrid validation | ◑ (dup logic) | ✓ | ◑ | ✓ | Reject |
| 4.3 Embedded output | ✓ (for snippets) | ✗ | ✗ (weak) | ✗ | Reject (general) |
| **4.4 Scenario tagging** | **✓** | **✓** | **✓ (explicit)** | **✓** | **Adopt** |

The split does **not** need rethinking. It needs a thin, explicit **mapping layer** on
top — which is exactly what scenario tagging provides.

---

## 5. Recommendation

A single coherent approach, layered so each tier is independently optional and the whole
thing is additive (a lab that opts into nothing behaves exactly as today).

### 5.1 The recommendation in one paragraph

**Adopt scenario tagging (§4.4).** Declare a **step catalog** in `labspace.yaml` sections;
tag the scenario that represents each step with **`completes: <step-id>`**. Surface
`completes` on `CommandOutcome` (a three-touch engine change riding on the already-
surfaced matched id) and record completions in a **dedicated `simspace:progress:<labId>`
localStorage store** that survives the exercise Reset. Render section check-marks and a
progress bar; offer an **xAPI-shaped JSON/CSV export** and a shareable resume link for
individual portability. For collective data, keep it **opt-in and config-driven**: Tier 1
cookieless analytics custom events (lowest effort), Tier 2 a configurable anonymous
`telemetry.endpoint` beacon (richer, per-session funnels). SCORM/LTI are out for the
static runtime; offer xAPI-file export (and, later, SCORM-zip packaging) as the LMS
bridge.

### 5.2 Why this fits the project principles

| Principle | How the recommendation honours it |
|-----------|-----------------------------------|
| **Static / server-free** | Individual tracking is 100% local (`localStorage`, existing pattern). Collective is opt-in and points at an *external* sink the author owns — nothing server-side ships with the app. |
| **Deterministic** | Completion is a pure function of `(state, command)` — it *is* the scenario match. No time/randomness/network in the engine; the engine only *reports* `completes`. Telemetry egress lives in the app layer. |
| **Lab-as-data** | Steps and tags are just YAML. Progress is derivable by replaying `history` through the same engine. No behaviour is hidden in code. |
| **Authoring simplicity** | One `completes:` line per tracked step + a small catalog. No restructuring of either file; opt-in and additive; lint-checked by `validate-lab`. |

### 5.3 Worked example

**`labspace.yaml`** — add a step catalog to sections (presentation owns *what appears*):

```yaml
sections:
  - title: Run a container
    contentPath: 01-run.md
    steps:
      - id: pull-image
        title: "Pull the nginx image"
      - id: run-container
        title: "Start the nginx container"

# Optional — opt-in collective telemetry (omit entirely to send nothing):
telemetry:
  endpoint: https://collect.example.com/labs
  events: [lab_started, section_viewed, step_completed, lab_completed]
  consent: implied           # anonymous session id only; no PII

# Optional — lowest-effort aggregate signal via cookieless analytics:
analytics:
  provider: plausible        # plausible | goatcounter | none
  domain: labs.example.com
```

**`simulator.yaml`** — tag the scenarios that mean "the learner did it" (behaviour owns
*when it's done*):

```yaml
scenarios:
  - id: pull-nginx
    completes: pull-image            # ← the only new line
    when:
      command: docker pull
      args: { 0: { any: true } }
    then:
      output:
        - "Using default tag: latest"
        - "Status: Downloaded newer image for {{ args.0 }}:latest"

  - id: run-container
    completes: run-container         # ← the only new line
    when:
      command: docker run
      args: { --name: { any: true }, -d: true }
      state: { container.running: false }
    then:
      state: { container.running: true, container.name: "{{ args.--name }}" }
      output: ["a1b2c3d4e5f6"]
```

**Section markdown** — unchanged. Run buttons work exactly as today; completion is driven
by the scenario firing, not by the block. (Optional future sugar: a `step=run-container`
fence token, B7, to let a block *advertise* which step it drives for UI affordances —
not required for tracking and explicitly **not** the source of truth.)

### 5.4 Engine / app changes (scoped)

1. **`engine/manifest.ts`** — preserve `completes` in `normalizeScenario` (B3). *~1 line.*
2. **`engine/run.ts`** — set `result.completes = m.scenario.completes` on a hit. *~1 line.*
3. **`engine/simulator.ts` + `types.ts`** — add `completes?: string` to `Result`/`CommandOutcome`. *small.*
4. **`labspace/loader.js`** — parse `sections[].steps[]` (and optional `telemetry`/`analytics`). *small.*
5. **App: progress store** — new `simspace:progress:<labId>` module + a completion hook at
   the `TerminalPanel.handleChange` / `MockTerminal`-after-`execute()` seam (B6):
   record step, update UI, fire telemetry/analytics events. *the bulk of the work.*
6. **UI** — section-nav check-marks, progress bar, "Download report," "Copy progress link,"
   optional consent prompt. *the bulk of the work.*
7. **`scripts/validate-lab.ts`** — flag dangling `completes:` (unknown step id) and
   unreachable steps (no scenario completes them). *small, high-value guardrail.*

The engine touches are minimal and keep it pure; the substance is UI + a small
persistence/telemetry module in the app layer, next to the localStorage code that
already exists.

---

## 6. Options summary table

### 6.1 Completion signal (§1, §4)

| Option | Authoring burden | Signal quality | Engine change | Recommended |
|--------|:---:|:---:|:---:|:---:|
| Section-viewed only | none | weak (viewed ≠ done) | none | as a rollup only |
| Code-block `step=` tag | low | weak (typed ≠ worked) | markdown parser | optional sugar |
| **Scenario `completes:` tag** | **one line/step** | **strong (did it)** | **~3 touches** | **✅ primary** |
| Step state-predicate | medium | strong, order-independent | evaluation pass | later / advanced |
| Embedded output (drop engine) | low (snippets) | weak + loses engine | large regression | ❌ reject |

### 6.2 Individual tracking (§2)

| Option | Server-free | Persists reload | Portable | Best role |
|--------|:---:|:---:|:---:|-----------|
| **localStorage progress store** | ✅ | ✅ | ✗ | **primary store** |
| URL/hash resume link | ✅ | ✗ (unless saved) | ✅ | share/resume link |
| Download report (JSON/CSV, xAPI-shaped) | ✅ | n/a | ✅ | LMS/instructor bridge |
| History-replay reconstruction | ✅ | derived | ✅ | verification bonus |

### 6.3 Collective telemetry (§3)

| Option | Needs infra | Per-learner funnel | Privacy default | Effort | Role |
|--------|:---:|:---:|:---:|:---:|------|
| Self-report (download+submit) | none | manual | maximal | low | floor / instructor-led |
| **Cookieless analytics events** | 3rd-party (or self-host) | ✗ aggregate only | no banner needed | **lowest** | Tier 1 — "are people finishing?" |
| **Configurable beacon endpoint** | author-hosted sink | ✅ within session | anon by default | medium | Tier 2 — real funnels |
| xAPI → file / anon endpoint | optional sink | depends | anon/consented | medium | LMS-ready record |
| xAPI direct-to-LRS | LRS + exposed cred | ✅ | ⚠️ cred risk | medium | ❌ discouraged (static) |
| SCORM | LMS + zip packaging | via LMS | via LMS | high | only as LMS package |
| LTI 1.3 | **backend required** | via LMS | via LMS | high | ❌ out for static |

---

## 7. Open questions (resolve before implementation)

- **O1 — Reset semantics for progress.** Should the exercise **Reset** clear the progress
  record? Recommendation: **no** — progress survives Reset; add a separate explicit
  "Reset progress." Confirm this is the desired learner behaviour.
- **O2 — Lab identity & versioning.** The progress key needs a stable `labId` (available
  from `simulator.yaml` `metadata.id`) **and** a `labVersion` to invalidate/migrate
  progress when a lab's steps change. `labspace.yaml` has **no version field today**
  (noted as deferred in its spec). Decide where lab version lives and the
  invalidation policy when steps are added/removed/renamed.
- **O3 — Step catalog location.** Recommended: `labspace.yaml` sections own the catalog
  (presentation), scenarios reference ids (behaviour). This creates a **cross-file
  reference** that `validate-lab` must check. Confirm the split vs. defining steps in
  `simulator.yaml` instead.
- **O4 — Multi-scenario / predicate steps.** Do any steps need "completed by *any* of N
  scenarios" or "complete when state predicate holds" rather than a single tagged
  scenario? If common, prioritise the state-predicate form (§1.1) sooner.
- **O5 — Enriching `history`.** Robust replay/reporting wants structured history entries
  (`{line, terminal, matched, completes, exit}`) and recorded control flips. This
  changes the reserved `history` shape — a `simulator.md` spec change. In or out of v1?
- **O6 — Consent model & "personal data" line.** Is an anonymous random `sessionId`
  personal data under the target jurisdictions? Define when `consent: implied` is
  acceptable vs. when an explicit opt-in banner is mandatory (any PII → required).
- **O7 — Agent-session turns.** Agent scenarios (`agent: true`) also carry ids — confirm
  `completes:` should work identically for them (recommended: yes; no extra work).
- **O8 — Analytics vs. beacon vs. both.** Should a lab be able to configure *both*
  cookieless analytics and a custom beacon, or pick one? Recommendation: allow both;
  they answer different questions (aggregate dashboard vs. per-session funnel).
- **O9 — Completion definition for a lab.** Is a lab "complete" when all steps across all
  sections are done, or when a designated set of *required* steps are? Consider an
  optional `required: true` on catalog steps for labs with optional/bonus tracks.

---

## 8. Suggested phasing

1. **Phase 1 — signal + individual (local).** `completes:` end-to-end (engine → outcome →
   progress store), step catalog parsing, section check-marks + progress bar,
   `validate-lab` guardrail. Resolves O1–O3. *Delivers visible learner value with zero
   external dependencies.*
2. **Phase 2 — portability.** Download report (JSON/CSV, xAPI-shaped) + resume link.
3. **Phase 3 — collective (opt-in).** Cookieless analytics events (Tier 1), then the
   configurable beacon endpoint + consent (Tier 2). Resolves O6, O8.
4. **Phase 4 (optional) — robustness/LMS.** Enriched `history` for replay (O5), xAPI
   file/endpoint hardening, and — if ever needed — SCORM-zip packaging as a build target.

---

## Appendix A — Key source references

- **Engine facts (this repo, read this session):** `app/src/engine/{run.ts,manifest.ts,
  simulator.ts,state.ts,types.ts}`, `app/src/context/TerminalContext.jsx`,
  `app/src/terminal/MockTerminal.tsx`, `app/src/components/**/TerminalPanel.jsx`,
  `app/src/components/WorkshopPanel/markdown/{codeIndexer.js,CodeBlock.jsx}`,
  `app/src/labspace/loader.js`, `app/src/context/WorkshopContext.jsx`; specs
  `spec/simulator.md`, `spec/labspace.md`.
- **xAPI:** ADL xAPI spec — https://github.com/adlnet/xAPI-Spec ; statement basics —
  https://xapi.com/statements-101/ ; verbs — http://adlnet.gov/expapi/verbs/ ;
  libraries — https://xapi.com/libraries/ .
- **SCORM RTE API dependency:** SCORM 2004 RTE (`API_1484_11`) — https://adlnet.gov/projects/scorm/ .
- **LTI 1.3 (backend requirement):** https://www.imsglobal.org/spec/lti/v1p3/ .
- **Cookieless analytics custom events:** Plausible — https://plausible.io/docs/custom-event-goals ;
  GoatCounter — https://www.goatcounter.com/help/events ; Cloudflare Web Analytics —
  https://developers.cloudflare.com/web-analytics/ .
- **Beaconing:** MDN `navigator.sendBeacon` —
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon ; `fetch` keepalive —
  https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch .
