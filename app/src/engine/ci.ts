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

/**
 * resolveCIRun turns a trigger + the workflow catalog into a complete run
 * record. Steps before the failed step succeed, the failed step fails, and any
 * steps after it are skipped — the natural CI failure model. On success, every
 * step succeeds. Throws when the referenced workflow is unknown so authoring
 * mistakes surface immediately.
 */
export function resolveCIRun(
  trigger: CITrigger,
  workflows: Workflow[] | undefined,
  runId: number,
): CIRun {
  const wf = (workflows ?? []).find((w) => w.id === trigger.workflow);
  if (!wf) {
    throw new Error(`ci: unknown workflow "${trigger.workflow}"`);
  }

  const conclusion = trigger.conclusion === "failure" ? "failure" : "success";
  const overrides = new Map((trigger.steps ?? []).map((o) => [o.id, o]));

  // On failure, pick the failing step: the named one, else the last step.
  const failedStepId =
    conclusion === "failure"
      ? (trigger.failedStep ?? wf.steps[wf.steps.length - 1]?.id)
      : undefined;
  const failedIndex =
    failedStepId !== undefined
      ? wf.steps.findIndex((s) => s.id === failedStepId)
      : -1;

  const steps: CIRunStep[] = wf.steps.map((step, i) => {
    const override = overrides.get(step.id);
    const logs = override?.logs ?? step.logs ?? [];
    let status: CIStepStatus = "success";
    if (failedIndex >= 0) {
      if (i < failedIndex) status = "success";
      else if (i === failedIndex) status = "failure";
      else status = "skipped";
    }
    return {
      id: step.id,
      name: override?.name ?? step.name,
      status,
      logs: [...logs],
    };
  });

  return {
    id: runId,
    workflow: wf.name,
    event: wf.on ?? "push",
    commit: trigger.commit ?? null,
    conclusion,
    error: conclusion === "failure" ? (trigger.error ?? null) : null,
    steps,
  };
}

/** ciRunToState converts a CIRun into a plain StateValue for the store. */
export function ciRunToState(run: CIRun): StateValue {
  return {
    id: run.id,
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
