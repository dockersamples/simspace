// End-to-end smoke test: boots the built server against an in-memory DB, then
// exercises ingest → presence → stats → catalog count over real HTTP. Exits
// non-zero on the first failed assertion. Run with `npm run test:smoke`.

import { spawn } from "node:child_process";

const PORT = 8899;
const TOKEN = "test-token";
const base = `http://127.0.0.1:${PORT}`;

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

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForReady(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/healthz`);
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

  // catalog completion count.
  let done = await (await fetch(`${base}/completed?labId=demo`)).json();
  check("completed = 0 before lab_completed", done.completed === 0, JSON.stringify(done));
  await post({ labId: "demo", sessionId: "s1", event: "lab_completed" });
  done = await (await fetch(`${base}/completed?labId=demo`)).json();
  check("completed = 1 after lab_completed", done.completed === 1, JSON.stringify(done));

  // A lab with no tracking config never appears.
  const empty = await (await fetch(`${base}/presence?labId=other`)).json();
  check("unknown lab has zero presence", empty.total === 0, JSON.stringify(empty));
} catch (e) {
  failures += 1;
  console.error("smoke error:", e.message);
} finally {
  child.kill("SIGTERM");
}

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
