// Resolves a scenario's `then.ci` trigger into a fully-determined CI run record
// that is appended to `state.ci.runs`. The engine stays pure: the run carries
// every step's final status up front — no time, no randomness. The CI panel
// replays it cosmetically. See spec/simulator.md §15.

import { CITrigger, StateValue, Workflow } from "./types";

/** The final status of a single step in a resolved run. */
export type CIStepStatus = "success" | "failure" | "skipped";

/** A resolved step, ready to store in state. */
export interface CIRunStep {
  id: string;
  name: string;
  status: CIStepStatus;
  logs: string[];
}

/** A resolved run record stored under `state.ci.runs`. */
export interface CIRun {
  /** 1-based run number, assigned from the current run count. */
  id: number;
  /** Catalog id of the workflow (used to re-run it from the CI panel). */
  workflowId: string;
  /** Display name of the workflow. */
  workflow: string;
  /** Cosmetic trigger event label (e.g. "push"). */
  event: string;
  /** Commit label, or null when the trigger omits it. */
  commit: string | null;
  conclusion: "success" | "failure";
  /** Error message shown on failure, else null. */
  error: string | null;
  steps: CIRunStep[];
}

/** truthy is the falsy-set a step's `requires` condition is tested against. */
function truthy(v: StateValue | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== "";
}

/**
 * resolveCIRun turns a trigger + the workflow catalog into a complete run
 * record. Steps before the failed step succeed, the failed step fails, and any
 * steps after it are skipped — the natural CI failure model. On success, every
 * step succeeds. Throws when the referenced workflow is unknown so authoring
 * mistakes surface immediately.
 *
 * The failing step is chosen one of two ways. If the trigger states a
 * `conclusion` explicitly, the run is fully scripted (failure at `failedStep`
 * or the last step). If it omits `conclusion`, the outcome is derived from
 * live state via `getState`: the first step whose `requires` path is falsy
 * fails the run. This lets a single scenario — and the CI panel's Re-run
 * button — reflect the current configuration (e.g. whether secrets are set).
 */
export function resolveCIRun(
  trigger: CITrigger,
  workflows: Workflow[] | undefined,
  runId: number,
  getState?: (path: string) => StateValue,
): CIRun {
  const wf = (workflows ?? []).find((w) => w.id === trigger.workflow);
  if (!wf) {
    throw new Error(`ci: unknown workflow "${trigger.workflow}"`);
  }

  const overrides = new Map((trigger.steps ?? []).map((o) => [o.id, o]));

  // Locate the failing step. Explicit `conclusion` scripts it; otherwise it is
  // the first step whose `requires` condition is unmet in the current state.
  let failedIndex = -1;
  if (trigger.conclusion === "failure") {
    const failedStepId =
      trigger.failedStep ?? wf.steps[wf.steps.length - 1]?.id;
    failedIndex =
      failedStepId !== undefined
        ? wf.steps.findIndex((s) => s.id === failedStepId)
        : -1;
  } else if (trigger.conclusion === undefined) {
    failedIndex = wf.steps.findIndex(
      (s) => s.requires !== undefined && !truthy(getState?.(s.requires)),
    );
  }
  const conclusion = failedIndex >= 0 ? "failure" : "success";

  const steps: CIRunStep[] = wf.steps.map((step, i) => {
    const override = overrides.get(step.id);
    let status: CIStepStatus = "success";
    if (failedIndex >= 0) {
      if (i < failedIndex) status = "success";
      else if (i === failedIndex) status = "failure";
      else status = "skipped";
    }
    // Log precedence: per-run override, then the step's failure logs when it is
    // the failing step, then its default (success) logs.
    const logs =
      override?.logs ??
      (status === "failure" ? step.failure?.logs : undefined) ??
      step.logs ??
      [];
    return {
      id: step.id,
      name: override?.name ?? step.name,
      status,
      logs: [...logs],
    };
  });

  // Error precedence: the trigger's explicit message, else the failing step's.
  const error =
    conclusion === "failure"
      ? (trigger.error ?? wf.steps[failedIndex]?.failure?.error ?? null)
      : null;

  return {
    id: runId,
    workflowId: wf.id,
    workflow: wf.name,
    event: wf.on ?? "push",
    commit: trigger.commit ?? null,
    conclusion,
    error,
    steps,
  };
}

/** ciRunToState converts a CIRun into a plain StateValue for the store. */
export function ciRunToState(run: CIRun): StateValue {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflow: run.workflow,
    event: run.event,
    commit: run.commit,
    conclusion: run.conclusion,
    error: run.error,
    steps: run.steps.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      logs: [...s.logs],
    })),
  };
}
