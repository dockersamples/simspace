// End-to-end smoke test: boots the built server against an in-memory DB, then
// exercises ingest → presence → stats → catalog count over real HTTP. Exits
// non-zero on the first failed assertion. Run with `npm run test:smoke`.

import { spawn } from "node:child_process";
import { request } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const PORT = 8899;
const TOKEN = "test-token";
const base = `http://127.0.0.1:${PORT}`;

// A second instance with a locked-down CORS allowlist, to exercise origin
// reflection independently of the open-by-default main instance.
const CORS_PORT = 8898;
const corsBase = `http://127.0.0.1:${CORS_PORT}`;
const ALLOWED = "https://alpha.example";
const DENIED = "https://evil.example";

// A third instance booted against a file DB seeded with the OLD (pre-origin)
// schema, to prove the on-boot migration runs. Must be file-backed — :memory:
// is always a fresh schema and never exercises the upgrade path.
const LEGACY_PORT = 8896;
const legacyBase = `http://127.0.0.1:${LEGACY_PORT}`;
const legacyDb = join(tmpdir(), `pulse-legacy-${process.pid}.db`);
const legacyDbFiles = [legacyDb, `${legacyDb}-wal`, `${legacyDb}-shm`];

const child = spawn("node", ["dist/server.cjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: ":memory:",
    STATS_TOKEN: TOKEN,
    PRESENCE_TTL_MS: "60000",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

let corsChild = null;
let legacyChild = null;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForReady(baseUrl = base, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become ready");
}

const post = (body) =>
  fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Raw HTTP so we can set an `Origin` header — `fetch` treats it as a forbidden
// request header and strips it, but Origin is exactly what the server uses to
// namespace lab data. Mirrors what a browser on that deployment would send.
function raw(method, path, { origin, token, body, baseUrl = base } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin) headers["Origin"] = origin;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = request(`${baseUrl}${path}`, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          json: data ? JSON.parse(data) : null,
        }),
      );
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

try {
  await waitForReady();

  // Two learners in lab "demo".
  await post([
    { labId: "demo", sessionId: "s1", event: "lab_started", sectionId: "intro" },
    {
      labId: "demo",
      sessionId: "s1",
      event: "step_completed",
      sectionId: "cli",
      stepId: "run-container",
      actor: { name: "Ada" },
      avatar: { emoji: "🐳", color: "#0db7ed" },
    },
    { labId: "demo", sessionId: "s2", event: "section_viewed", sectionId: "intro" },
  ]);

  const pres = await (await fetch(`${base}/presence?labId=demo`)).json();
  check("presence total = 2", pres.total === 2, JSON.stringify(pres));
  check(
    "milestone reflects completed step",
    pres.perMilestone["run-container"] === 1,
    JSON.stringify(pres.perMilestone),
  );
  check(
    "reading position tracked per section",
    pres.perSection["intro"] === 1 && pres.perSection["cli"] === 1,
    JSON.stringify(pres.perSection),
  );
  check(
    "avatar carries opted-in name",
    pres.avatars.some((a) => a.name === "Ada"),
    JSON.stringify(pres.avatars),
  );

  // leave drops presence.
  await post({ labId: "demo", sessionId: "s2", event: "leave" });
  const pres2 = await (await fetch(`${base}/presence?labId=demo`)).json();
  check("leave decrements presence", pres2.total === 1, JSON.stringify(pres2));

  // stats gating.
  const noAuth = await fetch(`${base}/stats?labId=demo`);
  check("stats without token = 401", noAuth.status === 401, `got ${noAuth.status}`);
  const stats = await (
    await fetch(`${base}/stats?labId=demo`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  ).json();
  check("stats starts = 1", stats.starts === 1, JSON.stringify(stats));
  check(
    "stats step completion counted",
    stats.steps.some((s) => s.stepId === "run-container" && s.distinctSessions === 1),
    JSON.stringify(stats.steps),
  );

  // Time window: a wide window still includes the seeded events; a 1ms window
  // excludes everything already recorded.
  const authed = { headers: { Authorization: `Bearer ${TOKEN}` } };
  const wide = await (
    await fetch(`${base}/stats?labId=demo&sinceMs=3600000`, authed)
  ).json();
  check("windowed stats (1h) includes recent starts", wide.starts === 1, JSON.stringify(wide));
  const tiny = await (
    await fetch(`${base}/stats?labId=demo&sinceMs=1`, authed)
  ).json();
  check("windowed stats (1ms) excludes older events", tiny.starts === 0, JSON.stringify(tiny));

  // catalog completion count.
  let done = await (await fetch(`${base}/completed?labId=demo`)).json();
  check("completed = 0 before lab_completed", done.completed === 0, JSON.stringify(done));
  await post({ labId: "demo", sessionId: "s1", event: "lab_completed" });
  done = await (await fetch(`${base}/completed?labId=demo`)).json();
  check("completed = 1 after lab_completed", done.completed === 1, JSON.stringify(done));

  // ── Origin namespacing ─────────────────────────────────────────────────────
  // The same labId served from two different deployments must stay isolated,
  // keyed by the request's Origin. (The earlier fetch-based "demo" events carry
  // no Origin, so they land under "unknown" — see the /labs checks below.)
  await raw("POST", "/events", {
    origin: "https://alpha.example",
    body: { labId: "shared", sessionId: "a1", event: "lab_started" },
  });
  await raw("POST", "/events", {
    origin: "https://beta.example",
    body: [
      { labId: "shared", sessionId: "b1", event: "lab_started" },
      { labId: "shared", sessionId: "b2", event: "lab_started" },
    ],
  });

  const presA = (
    await raw("GET", "/presence?labId=shared", { origin: "https://alpha.example" })
  ).json;
  check("origin A sees only its own presence", presA.total === 1, JSON.stringify(presA));
  check(
    "presence aggregate carries its origin",
    presA.origin === "https://alpha.example",
    JSON.stringify(presA),
  );
  const presB = (
    await raw("GET", "/presence?labId=shared", { origin: "https://beta.example" })
  ).json;
  check("origin B is isolated from origin A", presB.total === 2, JSON.stringify(presB));

  const statsA = (
    await raw("GET", "/stats?labId=shared", {
      origin: "https://alpha.example",
      token: TOKEN,
    })
  ).json;
  check("stats are namespaced by origin", statsA.starts === 1, JSON.stringify(statsA));

  // ── Tracked-lab inventory (/labs) ───────────────────────────────────────────
  const labsNoAuth = await raw("GET", "/labs");
  check("/labs without token = 401", labsNoAuth.status === 401, `got ${labsNoAuth.status}`);

  const labsList = (await raw("GET", "/labs", { token: TOKEN })).json;
  const sharedRows = labsList.labs.filter((l) => l.labId === "shared");
  check(
    "/labs lists both origins of a shared labId",
    sharedRows.length === 2,
    JSON.stringify(labsList.labs),
  );
  check(
    "/labs rows carry origin + counts",
    sharedRows.every((l) => l.origin && l.starts >= 1 && l.events >= 1),
    JSON.stringify(sharedRows),
  );
  check(
    "/labs enriches rows with live hereNow",
    sharedRows.some((l) => l.hereNow >= 1),
    JSON.stringify(sharedRows),
  );
  const demoRow = labsList.labs.find((l) => l.labId === "demo");
  check(
    "/labs surfaces non-browser (no-Origin) events under 'unknown'",
    demoRow && demoRow.origin === "unknown",
    JSON.stringify(demoRow),
  );

  // A lab with no tracking config never appears.
  const empty = await (await fetch(`${base}/presence?labId=other`)).json();
  check("unknown lab has zero presence", empty.total === 0, JSON.stringify(empty));

  // SSE stream emits an initial aggregate frame.
  const ac = new AbortController();
  const stream = await fetch(`${base}/stream?labId=demo`, { signal: ac.signal });
  const reader = stream.body.getReader();
  const { value } = await reader.read();
  const frame = new TextDecoder().decode(value);
  check("stream emits a data frame", frame.startsWith("data: "), frame.slice(0, 40));
  const parsed = JSON.parse(frame.replace(/^data: /, "").trim());
  check("stream frame carries presence total", parsed.total === 1, JSON.stringify(parsed));
  ac.abort();

  // ── CORS: open by default ──────────────────────────────────────────────────
  // The main instance has no CORS_ORIGIN set, so it echoes "*" to everyone.
  const openCors = await raw("GET", "/healthz", { origin: DENIED });
  check(
    "default CORS allows any origin (*)",
    openCors.headers["access-control-allow-origin"] === "*",
    JSON.stringify(openCors.headers),
  );

  // ── CORS: locked-down allowlist ─────────────────────────────────────────────
  // A second instance restricted to ALLOWED reflects an on-list Origin (with
  // Vary: Origin) and sends no allow header at all to an off-list one.
  corsChild = spawn("node", ["dist/server.cjs"], {
    env: {
      ...process.env,
      PORT: String(CORS_PORT),
      DB_PATH: ":memory:",
      STATS_TOKEN: TOKEN,
      CORS_ORIGIN: ALLOWED,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitForReady(corsBase);

  const okCors = await raw("GET", "/healthz", { origin: ALLOWED, baseUrl: corsBase });
  check(
    "allowlist reflects an on-list Origin",
    okCors.headers["access-control-allow-origin"] === ALLOWED,
    JSON.stringify(okCors.headers),
  );
  check(
    "allowlist marks the response Vary: Origin",
    (okCors.headers["vary"] || "").toLowerCase().includes("origin"),
    JSON.stringify(okCors.headers),
  );
  const denied = await raw("GET", "/healthz", { origin: DENIED, baseUrl: corsBase });
  check(
    "allowlist sends no allow header to an off-list Origin",
    denied.headers["access-control-allow-origin"] === undefined,
    JSON.stringify(denied.headers),
  );
  const preflight = await raw("OPTIONS", "/events", { origin: ALLOWED, baseUrl: corsBase });
  check(
    "allowlist preflight (OPTIONS) reflects the on-list Origin",
    preflight.status === 204 &&
      preflight.headers["access-control-allow-origin"] === ALLOWED,
    `${preflight.status} ${JSON.stringify(preflight.headers)}`,
  );

  // ── Migration: booting against a pre-origin DB ──────────────────────────────
  // Regression guard: the origin index once referenced the column before the
  // ALTER that adds it, so an existing volume threw "no such column: origin"
  // on boot. Seed the old schema, then boot the real binary against it.
  for (const f of legacyDbFiles) if (existsSync(f)) rmSync(f);
  const seed = new Database(legacyDb);
  seed.pragma("journal_mode = WAL");
  seed.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_id TEXT NOT NULL, lab_version TEXT, session_id TEXT NOT NULL,
      actor_id TEXT, event TEXT NOT NULL, section_id TEXT, step_id TEXT,
      ts_client TEXT, ts_server TEXT NOT NULL);
    CREATE INDEX idx_events_lab ON events (lab_id, event);
  `);
  seed
    .prepare(
      `INSERT INTO events (lab_id, session_id, event, ts_server) VALUES (?,?,?,?)`,
    )
    .run("legacy-lab", "s-old", "lab_completed", "2026-01-01T00:00:00.000Z");
  seed.close();

  legacyChild = spawn("node", ["dist/server.cjs"], {
    env: {
      ...process.env,
      PORT: String(LEGACY_PORT),
      DB_PATH: legacyDb,
      STATS_TOKEN: TOKEN,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitForReady(legacyBase);

  const legacyHealth = await raw("GET", "/healthz", { baseUrl: legacyBase });
  check(
    "boots against a pre-origin DB (migration adds the column)",
    legacyHealth.status === 200,
    JSON.stringify(legacyHealth),
  );
  const legacyLabs = (
    await raw("GET", "/labs", { token: TOKEN, baseUrl: legacyBase })
  ).json;
  const legacyRow = legacyLabs.labs.find((l) => l.labId === "legacy-lab");
  check(
    "pre-existing rows survive migration under origin 'unknown'",
    legacyRow && legacyRow.origin === "unknown" && legacyRow.completions === 1,
    JSON.stringify(legacyLabs.labs),
  );
} catch (e) {
  failures += 1;
  console.error("smoke error:", e.message);
} finally {
  child.kill("SIGTERM");
  if (corsChild) corsChild.kill("SIGTERM");
  if (legacyChild) legacyChild.kill("SIGTERM");
  for (const f of legacyDbFiles) {
    try {
      if (existsSync(f)) rmSync(f);
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
