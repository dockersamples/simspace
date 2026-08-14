import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActiveSection, useWorkshop } from "./WorkshopContext.jsx";
import { useTerminal } from "./TerminalContext.jsx";
import * as progress from "../labspace/progress.js";

// Records the learner's progress through a lab's author-defined steps and
// exposes it to the UI (nav check-marks, milestones, resume).
//
// A "step" is completed when a scenario tagged `completes: <step-id>` fires; the
// engine surfaces that on the command outcome, TerminalPanel re-broadcasts it as
// a `step` event, and this context records it in the local progress store.
//
// TWO layers, and only the second is optional:
//
//   1. Local progress — the learner's own check-marks and resume. Needs ONLY a
//      step catalog in labspace.yaml. No network, no configuration, always on.
//      This is why the analytics seam below is NOT simply "swap the whole
//      context for a no-op": doing that would take the check-marks with it.
//   2. Reporting — the same milestones handed to an injected `analytics`
//      adapter. The default adapter does nothing, so an embedded runtime makes
//      zero network calls until its host supplies one. Where the events go, what
//      wire format they take, and whether live presence is polled back are all
//      the adapter's business; this context only knows what happened and when.
//
// The lab app supplies a `pulse` adapter. A host that wants its own analytics
// writes ~30 lines and changes nothing here.

const ProgressContext = createContext(null);

// Doing nothing is the default, so an embed is silent until told otherwise.
const NO_OP_ANALYTICS = { track() {} };

export function ProgressContextProvider({
  children,
  analytics = NO_OP_ANALYTICS,
  // What the learner is currently looking at, if it isn't the active section.
  // A deck's position is its current SLIDE, not the chapter file the slide came
  // from, so the deck passes that; a lab passes nothing.
  positionId,
}) {
  const workshop = useWorkshop();
  const { subscribe } = useTerminal();
  const { activeSection } = useActiveSection();

  const labKey = workshop.labKey || "";
  const labId = analytics.labId || labKey;
  const labVersion = workshop.version || null;
  const meta = useMemo(() => ({ labId, labVersion }), [labId, labVersion]);

  // Actor identity is created synchronously (localStorage) so events can carry
  // it from the very first render. The provider remounts per lab, so this
  // initializer re-runs when the lab changes.
  const identityRef = useRef(null);
  if (!identityRef.current)
    identityRef.current = progress.getActor(labKey, meta);

  const [completed, setCompleted] = useState(
    () => progress.loadProgress(labKey, meta).completed || {},
  );
  const [presence, setPresence] = useState(null);

  const activeSectionId = positionId ?? activeSection?.id;
  const activeSectionRef = useRef(activeSectionId);
  activeSectionRef.current = activeSectionId;

  // Every event carries the same identity envelope; the adapter decides what to
  // do with it. Held in a ref so a host passing an inline adapter object doesn't
  // re-run every effect below on each of its renders.
  const analyticsRef = useRef(analytics);
  analyticsRef.current = analytics;

  const track = useCallback(
    (event, extra = {}) => {
      const { actor, avatar } = identityRef.current || {};
      try {
        analyticsRef.current?.track?.(event, {
          labId,
          labVersion,
          sessionId: actor?.id,
          actor,
          avatar,
          ...extra,
        });
      } catch (e) {
        // A broken adapter must never take the lab down with it.
        console.error("analytics adapter threw:", e);
      }
    },
    [labId, labVersion],
  );

  const totalSteps = useMemo(
    () =>
      (workshop.sections || []).reduce(
        (n, s) => n + (s.steps ? s.steps.length : 0),
        0,
      ),
    [workshop],
  );

  // Marks the whole lab finished. Idempotent, and exposed on the context because
  // "finished" isn't always "every step done" — a deck has no steps, so the app
  // calls this when the learner reaches the last slide.
  const labCompleteSentRef = useRef(false);
  const completeLab = useCallback(() => {
    if (labCompleteSentRef.current) return;
    labCompleteSentRef.current = true;
    progress.markLabComplete(labKey);
    track("lab_completed");
  }, [labKey, track]);

  // Record completions as `step` events arrive from any terminal.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event) => {
      if (event.type === "reset") {
        track("reset");
        return;
      }
      if (event.type !== "step" || !event.stepId) return;
      const before = progress.completedSteps(labKey);
      const already = Boolean(before[event.stepId]);
      const next = progress.markComplete(labKey, event.stepId, {
        command: event.command,
        scenario: event.scenario,
      });
      setCompleted(next);
      if (!already) {
        track("step_completed", {
          stepId: event.stepId,
          sectionId: activeSectionRef.current,
        });
      }
      if (totalSteps > 0 && Object.keys(next).length >= totalSteps) {
        completeLab();
      }
    });
  }, [subscribe, labKey, track, totalSteps, completeLab]);

  // lab_started once per mount.
  useEffect(() => {
    track("lab_started", { sectionId: activeSectionRef.current });
  }, [track]);

  // section_viewed whenever the position changes.
  useEffect(() => {
    if (!activeSectionId) return;
    track("section_viewed", { sectionId: activeSectionId });
  }, [activeSectionId, track]);

  // Heartbeat while the tab is visible, plus a leave signal on unload. Only an
  // adapter that asks for it (by declaring an interval) gets a timer — a no-op
  // adapter must not leave one running in someone else's page.
  const heartbeatMs = analytics.heartbeatMs || 0;
  useEffect(() => {
    if (!heartbeatMs) return undefined;
    const beat = () => {
      if (document.visibilityState === "visible") {
        track("heartbeat", { sectionId: activeSectionRef.current });
      }
    };
    beat();
    const timer = setInterval(beat, heartbeatMs);
    const onHide = () => track("leave");
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      track("leave");
    };
  }, [heartbeatMs, track]);

  // Live presence, when the adapter can supply it. The adapter owns the
  // transport (pulse uses SSE with a polling fallback); this just renders what
  // it pushes.
  useEffect(() => {
    const subscribePresence = analyticsRef.current?.subscribePresence;
    if (!subscribePresence) return undefined;
    return subscribePresence((data) => setPresence(data));
    // Re-subscribe when the lab changes, not when the host re-renders.
  }, [labId]);

  const isStepComplete = useCallback(
    (stepId) => Boolean(completed[stepId]),
    [completed],
  );

  // A section is complete when all of its cataloged steps are complete. A
  // section with no steps carries no completion signal (nav shows no check).
  const isSectionComplete = useCallback(
    (section) => {
      const steps = section?.steps || [];
      if (steps.length === 0) return false;
      return steps.every((s) => completed[s.id]);
    },
    [completed],
  );

  const resetProgress = useCallback(() => {
    setCompleted(progress.resetProgress(labKey));
    labCompleteSentRef.current = false;
  }, [labKey]);

  const value = useMemo(
    () => ({
      completedSteps: completed,
      isStepComplete,
      isSectionComplete,
      actor: identityRef.current?.actor || null,
      avatar: identityRef.current?.avatar || null,
      resetProgress,
      completeLab,
      // Whether this lab has any tracked steps at all — lets the UI hide
      // progress affordances entirely for labs that opt out.
      hasSteps: totalSteps > 0,
      // Live presence from the adapter (null when it supplies none).
      presence,
      presenceEnabled: Boolean(presence),
    }),
    [
      completed,
      isStepComplete,
      isSectionComplete,
      resetProgress,
      completeLab,
      totalSteps,
      presence,
    ],
  );

  return (
    <ProgressContext.Provider value={value}>
      {children}
    </ProgressContext.Provider>
  );
}

export const useProgress = () => useContext(ProgressContext);
