import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "../../context/TerminalContext";
import "./CIPanel.scss";

// Cosmetic playback pacing (presentation only — the run itself is fully
// determined by the engine, so this never changes what is shown, only when).
const QUEUE_MS = 600;
const STEP_MS = 900;

// A GitHub-Actions-style CI page (rendered as a tab in the terminal pane). It
// derives its runs entirely from the shared simulator state (`ci.runs`), so a
// `git push` in any terminal makes a run appear here. The newest run plays back
// queued -> in-progress -> per-step -> success/failure with cosmetic delays;
// older runs render in their final state. Reset clears the list with the state.
function readRuns(sim) {
  if (!sim) return [];
  const runs = sim.getState("ci.runs");
  return Array.isArray(runs) ? runs : [];
}

const STATUS_ICON = {
  success: "check_circle",
  failure: "cancel",
  running: "progress_activity",
  queued: "pending",
  skipped: "do_not_disturb_on",
};

const RUN_LABEL = {
  success: "Success",
  failure: "Failure",
  running: "In progress",
  queued: "Queued",
};

export function CIPanel() {
  const { simulator, subscribe } = useTerminal();
  const [runs, setRuns] = useState(() => readRuns(simulator));
  // The run currently animating: { runId, phase: "queued"|"in_progress", running }.
  const [anim, setAnim] = useState(null);
  const [expanded, setExpanded] = useState({});

  // Highest run id already played (so peers' state events don't replay it), the
  // id currently animating, and any pending timers to clear on reset/unmount.
  const playedRef = useRef(0);
  const animatingRef = useRef(null);
  const timersRef = useRef([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  // Play a single run back cosmetically: queued -> each executed step -> done.
  // Steps carry their final status already; we just reveal them over time and
  // stop at the failed step (steps after it are "skipped" in the data).
  const animateRun = useCallback((run) => {
    animatingRef.current = run.id;
    setExpanded({ [run.id]: true });
    setAnim({ runId: run.id, phase: "queued", running: -1 });

    const schedule = (fn, ms) => {
      const t = setTimeout(fn, ms);
      timersRef.current.push(t);
    };

    const finish = () => {
      playedRef.current = run.id;
      animatingRef.current = null;
      setAnim(null);
    };

    const steps = run.steps ?? [];
    const runStep = (i, delay) => {
      schedule(() => {
        setAnim({ runId: run.id, phase: "in_progress", running: i });
        // If this step is the one that fails, stop here — the run is done and
        // any later steps are already marked skipped in the data.
        if (steps[i].status === "failure") {
          schedule(finish, STEP_MS);
          return;
        }
        if (i + 1 < steps.length) {
          runStep(i + 1, STEP_MS);
        } else {
          schedule(finish, STEP_MS);
        }
      }, delay);
    };

    if (steps.length === 0) {
      schedule(finish, QUEUE_MS);
    } else {
      runStep(0, QUEUE_MS);
    }
  }, []);

  // Re-read runs on every shared-state change; animate a newly-appeared run.
  const refresh = useCallback(() => {
    const next = readRuns(simulator);
    setRuns(next);
    const newest = next[next.length - 1];
    if (
      newest &&
      newest.id > playedRef.current &&
      animatingRef.current !== newest.id
    ) {
      animateRun(newest);
    }
  }, [simulator, animateRun]);

  // On mount / simulator swap, treat existing runs as already played so only
  // runs created afterward animate.
  useEffect(() => {
    clearTimers();
    animatingRef.current = null;
    setAnim(null);
    const current = readRuns(simulator);
    setRuns(current);
    playedRef.current = current[current.length - 1]?.id ?? 0;
    setExpanded(
      current.length ? { [current[current.length - 1].id]: true } : {},
    );
  }, [simulator, clearTimers]);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type === "reset") {
        clearTimers();
        animatingRef.current = null;
        playedRef.current = 0;
        setAnim(null);
        setExpanded({});
        setRuns([]);
        return;
      }
      refresh();
    });
  }, [subscribe, refresh, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  const newestId = runs[runs.length - 1]?.id;
  const isExpanded = (run) => expanded[run.id] ?? run.id === newestId;
  const toggle = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? id === newestId) }));

  // Resolves the display status of a step given the current animation frame.
  const stepStatus = (run, index, step) => {
    if (anim && anim.runId === run.id) {
      if (anim.phase === "queued" || index > anim.running) return "queued";
      if (index === anim.running) return "running";
      // index < anim.running — already executed; show its real outcome.
    }
    return step.status;
  };

  // Run-level status: animating runs report queued/in-progress; else the
  // resolved conclusion.
  const runStatus = (run) => {
    if (anim && anim.runId === run.id) {
      return anim.phase === "queued" ? "queued" : "running";
    }
    return run.conclusion;
  };

  return (
    <div className="ci-panel">
      <div className="ci-scroll">
        <header className="ci-head">
          <h2 className="ci-title">Continuous integration</h2>
          <p className="ci-subtitle">
            Simulated workflow runs. Note that logs are incomplete and simulated.
          </p>
        </header>

        {runs.length === 0 ? (
          <div className="ci-empty">
            <span className="material-symbols-outlined ci-empty-icon">
              rocket_launch
            </span>
            <p className="ci-empty-text">No workflow runs yet.</p>
            <p className="ci-empty-hint">
              A run appears here when the pipeline is triggered — for example,
              after a <code>git push</code>.
            </p>
          </div>
        ) : (
          <ul className="ci-runs">
            {[...runs].reverse().map((run) => {
              const status = runStatus(run);
              const open = isExpanded(run);
              return (
                <li key={run.id} className={`ci-run ci-run-${status}`}>
                  <button
                    type="button"
                    className="ci-run-head"
                    onClick={() => toggle(run.id)}
                    aria-expanded={open}
                  >
                    <span
                      className={`material-symbols-outlined ci-status-icon ci-status-${status}`}
                    >
                      {STATUS_ICON[status]}
                    </span>
                    <span className="ci-run-text">
                      <span className="ci-run-workflow">{run.workflow}</span>
                      {run.commit && (
                        <span className="ci-run-commit">{run.commit}</span>
                      )}
                    </span>
                    <span className="ci-run-meta">
                      <span className="ci-run-event">{run.event}</span>
                      <span className="ci-run-number">#{run.id}</span>
                    </span>
                    <span className="material-symbols-outlined ci-run-chevron">
                      {open ? "expand_less" : "expand_more"}
                    </span>
                  </button>

                  {open && (
                    <div className="ci-run-body">
                      <ol className="ci-steps">
                        {(run.steps ?? []).map((step, i) => {
                          const st = stepStatus(run, i, step);
                          const showLogs =
                            (st === "running" ||
                              st === "success" ||
                              st === "failure") &&
                            step.logs?.length > 0;
                          return (
                            <li
                              key={step.id}
                              className={`ci-step ci-step-${st}`}
                            >
                              <div className="ci-step-head">
                                <span
                                  className={`material-symbols-outlined ci-status-icon ci-status-${st}`}
                                >
                                  {STATUS_ICON[st]}
                                </span>
                                <span className="ci-step-name">
                                  {step.name}
                                </span>
                              </div>
                              {showLogs && (
                                <pre className="ci-step-logs">
                                  {step.logs.join("\n")}
                                </pre>
                              )}
                            </li>
                          );
                        })}
                      </ol>

                      {status === "failure" && run.error && (
                        <div className="ci-error">
                          <span className="material-symbols-outlined">
                            error
                          </span>
                          <span>{run.error}</span>
                        </div>
                      )}

                      <div className="ci-run-footer">
                        {RUN_LABEL[status] ?? status}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
