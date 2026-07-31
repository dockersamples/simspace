import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { loadLabspace } from "../../labspace/loader";
import "./InsightsDashboard.scss";

// Instructor-only dashboard for one lab's CUMULATIVE analytics — the funnel and
// per-step drop-off that must never appear inside a running lab (see
// spec/labspace.md §10.2 for why).
// It reads pulse's token-gated /stats, so it prompts for the instructor token
// (remembered per backend in sessionStorage) and never exposes it to learners.
//
// This is the ONE place drop-off is shown, to an instructor who asked for it.

const tokenKey = (endpoint) => `simspace:stats-token:${endpoint}`;

// The dashboard silently re-fetches /stats on this cadence so it can be left
// open (in a background window during a workshop) and stay current. The
// interval is instructor-selectable; `0` turns auto-refresh off. Persisted so
// the choice sticks across visits.
const INTERVAL_KEY = "simspace:stats-interval";
const DEFAULT_INTERVAL_MS = 15000;
const INTERVAL_OPTIONS = [
  { label: "Every 5s", value: 5000 },
  { label: "Every 10s", value: 10000 },
  { label: "Every 15s", value: 15000 },
  { label: "Every 30s", value: 30000 },
  { label: "Every 60s", value: 60000 },
  { label: "Off", value: 0 },
];

// Time window for the stats. `0` = all-time (the default, so nothing changes
// unless an instructor scopes it). Passed to /stats as `sinceMs`; the server
// computes a sliding cutoff from its own clock. Persisted like the interval.
const HOUR = 3600000;
const WINDOW_KEY = "simspace:stats-window";
const DEFAULT_WINDOW_MS = 0;
const WINDOW_OPTIONS = [
  { label: "Last 3 hours", value: 3 * HOUR },
  { label: "Last day", value: 24 * HOUR },
  { label: "Last week", value: 7 * 24 * HOUR },
  { label: "Last month", value: 30 * 24 * HOUR },
  { label: "All time", value: 0 },
];

// Reads a persisted numeric option. An ABSENT key falls back to the default;
// a stored value is honored only if it's still a valid option. (A plain
// `Number(getItem())` can't tell "unset" from a stored 0 — both look like 0 —
// which would wrongly resolve an empty store to the 0-valued option.)
function readStored(key, options, fallback) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  const value = Number(raw);
  return options.some((o) => o.value === value) ? value : fallback;
}

export function InsightsDashboard({ lab }) {
  const endpoint = lab.tracking.endpoint.replace(/\/+$/, "");
  const labId = lab.tracking.labId;

  const [token, setToken] = useState(
    () => sessionStorage.getItem(tokenKey(endpoint)) || "",
  );
  const [tokenInput, setTokenInput] = useState("");
  const [stats, setStats] = useState(null);
  const [labspace, setLabspace] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [intervalMs, setIntervalMs] = useState(() =>
    readStored(INTERVAL_KEY, INTERVAL_OPTIONS, DEFAULT_INTERVAL_MS),
  );

  const [windowMs, setWindowMs] = useState(() =>
    readStored(WINDOW_KEY, WINDOW_OPTIONS, DEFAULT_WINDOW_MS),
  );
  // Read inside `refresh` (and the poll) so the current window is always used
  // without making `refresh` change identity — keeps the poll effect stable.
  const windowRef = useRef(windowMs);

  const changeInterval = useCallback((ms) => {
    setIntervalMs(ms);
    try {
      localStorage.setItem(INTERVAL_KEY, String(ms));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    document.title = `${lab.title} — Insights`;
  }, [lab.title]);

  // Load the labspace once to label and order steps/sections in lab order.
  useEffect(() => {
    let cancelled = false;
    loadLabspace(lab.labspaceUrl)
      .then((data) => !cancelled && setLabspace(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lab.labspaceUrl]);

  // Fetches /stats. `silent` (used by the background poll and manual refresh
  // once loaded) updates the data in place without the full-page loading/error
  // states, so a transient blip never kicks the instructor back to the gate.
  const refresh = useCallback(
    async (tok, { silent = false } = {}) => {
      if (!tok) return;
      if (!silent) {
        setState("loading");
        setError("");
      }
      try {
        const since = windowRef.current ? `&sinceMs=${windowRef.current}` : "";
        const res = await fetch(
          `${endpoint}/stats?labId=${encodeURIComponent(labId)}${since}`,
          { headers: { Authorization: `Bearer ${tok}` } },
        );
        if (!res.ok) {
          if (silent) return; // keep showing the last good data on a poll blip
          setState("error");
          if (res.status === 401) {
            setError("That token was rejected. Check it and try again.");
          } else if (res.status === 404) {
            setError(
              "This backend has stats disabled (no STATS_TOKEN configured on the server).",
            );
          } else {
            setError(`Request failed (HTTP ${res.status}).`);
          }
          return;
        }
        setStats(await res.json());
        setUpdatedAt(new Date());
        if (!silent) {
          setState("ready");
          sessionStorage.setItem(tokenKey(endpoint), tok);
          setToken(tok);
        }
      } catch (e) {
        if (silent) return;
        setState("error");
        setError(`Could not reach the backend: ${e.message}`);
      }
    },
    [endpoint, labId],
  );

  const changeWindow = useCallback(
    (ms) => {
      windowRef.current = ms;
      setWindowMs(ms);
      try {
        localStorage.setItem(WINDOW_KEY, String(ms));
      } catch {
        /* ignore storage errors */
      }
      // Refetch immediately (silently) so the numbers reflect the new window.
      if (token) refresh(token, { silent: true });
    },
    [token, refresh],
  );

  // Auto-load when a token is already remembered for this backend.
  useEffect(() => {
    if (token) refresh(token);
  }, [token, refresh]);

  // Once loaded, keep the dashboard current by polling in the background. It
  // keeps polling even when the tab is blurred/hidden, so you can run a workshop
  // in one window and watch stats in another. `intervalMs === 0` turns it off.
  useEffect(() => {
    if (state !== "ready" || !token || !intervalMs) return undefined;
    const id = setInterval(() => refresh(token, { silent: true }), intervalMs);
    return () => clearInterval(id);
  }, [state, token, refresh, intervalMs]);

  // ── Derived, lab-ordered chart data ─────────────────────────────────────────
  const model = useMemo(() => {
    if (!stats) return null;
    const sections = labspace?.sections || [];
    const stepStats = new Map((stats.steps || []).map((s) => [s.stepId, s]));
    const sectionStats = new Map(
      (stats.sections || []).map((s) => [s.sectionId, s]),
    );

    const orderedSteps = [];
    for (const sec of sections) {
      for (const st of sec.steps || []) {
        orderedSteps.push({
          id: st.id,
          title: st.title || st.id,
          value: stepStats.get(st.id)?.distinctSessions || 0,
        });
      }
    }
    // If the labspace hasn't loaded (or has no catalog), fall back to whatever
    // steps the backend reports so the funnel still renders.
    if (!orderedSteps.length) {
      for (const s of stats.steps || []) {
        orderedSteps.push({
          id: s.stepId,
          title: s.stepId,
          value: s.distinctSessions,
        });
      }
    }

    const funnel = [
      {
        id: "__start",
        title: "Started the lab",
        value: stats.starts,
        kind: "anchor",
      },
      ...orderedSteps.map((s) => ({ ...s, kind: "step" })),
      {
        id: "__complete",
        title: "Completed the lab",
        value: stats.completions,
        kind: "goal",
      },
    ];

    const sectionRows = (
      sections.length
        ? sections.map((sec) => ({
            id: sec.id,
            title: sec.title,
            value: sectionStats.get(sec.id)?.distinctSessions || 0,
          }))
        : (stats.sections || []).map((s) => ({
            id: s.sectionId,
            title: s.sectionId,
            value: s.distinctSessions,
          }))
    ).filter(Boolean);

    const rate = stats.starts
      ? Math.round((stats.completions / stats.starts) * 100)
      : 0;

    return { funnel, sectionRows, rate };
  }, [stats, labspace]);

  const backLink = (
    <Link to="/" className="insights-back">
      <span className="material-symbols-outlined">arrow_back</span>
      All labs
    </Link>
  );

  // ── Token gate ───────────────────────────────────────────────────────────────
  if (state !== "ready") {
    return (
      <div className="insights">
        <header className="insights-header">
          {backLink}
          <h1 className="insights-title">{lab.title} — Insights</h1>
          <p className="insights-subtitle">
            Instructor view. Cumulative completion data for this lab — never
            shown to learners inside the lab.
          </p>
        </header>
        <form
          className="insights-gate"
          onSubmit={(e) => {
            e.preventDefault();
            refresh(tokenInput.trim());
          }}
        >
          <label htmlFor="stats-token" className="insights-gate-label">
            Instructor token
          </label>
          <div className="insights-gate-row">
            <input
              id="stats-token"
              type="password"
              className="insights-gate-input"
              placeholder="Enter the backend's STATS_TOKEN"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="insights-gate-btn"
              disabled={state === "loading" || !tokenInput.trim()}
            >
              {state === "loading" ? "Loading…" : "View insights"}
            </button>
          </div>
          {state === "error" && <p className="insights-error">{error}</p>}
          <p className="insights-gate-hint">
            The token is set as <code>STATS_TOKEN</code> on the pulse backend
            and is kept only in this tab.
          </p>
        </form>
      </div>
    );
  }

  const maxFunnel = Math.max(1, ...model.funnel.map((f) => f.value));
  const maxSection = Math.max(1, ...model.sectionRows.map((s) => s.value));

  return (
    <div className="insights">
      <header className="insights-header">
        {backLink}
        <h1 className="insights-title">{lab.title} — Insights</h1>
        <p className="insights-subtitle">
          Instructor view · lab id <code>{labId}</code>
        </p>
        <label className="insights-window">
          <span className="insights-window-label">Showing</span>
          <select
            value={windowMs}
            onChange={(e) => changeWindow(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="insights-tiles">
        <Tile label="Started" value={stats.starts} />
        <Tile label="Completed" value={stats.completions} />
        <Tile label="Completion rate" value={`${model.rate}%`} />
      </div>

      <section className="insights-card">
        <div className="insights-card-head">
          <h2 className="insights-card-title">Progress funnel</h2>
          <div className="insights-live">
            <span
              className={"insights-live-badge" + (intervalMs ? "" : " is-off")}
              title={intervalMs ? "Auto-refreshing" : "Auto-refresh off"}
            >
              <span className="insights-live-dot" />
              {intervalMs ? "Live" : "Paused"}
            </span>
            {updatedAt && (
              <span className="insights-updated">
                updated {updatedAt.toLocaleTimeString()}
              </span>
            )}
            <label className="insights-interval">
              <span className="visually-hidden">Refresh interval</span>
              <select
                value={intervalMs}
                onChange={(e) => changeInterval(Number(e.target.value))}
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="insights-refresh"
              onClick={() => refresh(token, { silent: true })}
              title="Refresh now"
            >
              <span className="material-symbols-outlined">refresh</span>
            </button>
          </div>
        </div>
        <p className="insights-card-note">
          Distinct learners reaching each milestone, in lab order. Where the
          bars narrow is where people drop off.
          {windowMs > 0 && (
            <>
              {" "}
              Counts activity within the selected window, so someone who started
              earlier but acted recently can appear at a later step than an
              earlier one.
            </>
          )}
        </p>
        <BarList rows={model.funnel} max={maxFunnel} variant="funnel" />
      </section>

      {model.sectionRows.length > 0 && (
        <section className="insights-card">
          <h2 className="insights-card-title">Section reach</h2>
          <p className="insights-card-note">
            Distinct learners who viewed each section.
          </p>
          <BarList
            rows={model.sectionRows}
            max={maxSection}
            variant="section"
          />
        </section>
      )}

      <details className="insights-raw">
        <summary>Raw data</summary>
        <pre>{JSON.stringify(stats, null, 2)}</pre>
      </details>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="insights-tile">
      <span className="insights-tile-value">{value}</span>
      <span className="insights-tile-label">{label}</span>
    </div>
  );
}

// A horizontal bar list — single-hue magnitude, value labelled at the end of
// each bar. Doubles as an accessible table (role=list rows with aria labels).
function BarList({ rows, max, variant }) {
  return (
    <ul className={`insights-bars insights-bars--${variant}`}>
      {rows.map((r) => {
        const pct = Math.round((r.value / max) * 100);
        return (
          <li
            key={r.id}
            className={"insights-bar" + (r.kind ? ` is-${r.kind}` : "")}
            aria-label={`${r.title}: ${r.value}`}
          >
            <span className="insights-bar-label" title={r.title}>
              {r.title}
            </span>
            <span className="insights-bar-track">
              <span
                className="insights-bar-fill"
                style={{ width: `${Math.max(pct, r.value > 0 ? 2 : 0)}%` }}
              />
            </span>
            <span className="insights-bar-value">{r.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
