import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActiveSection, useWorkshop } from "../WorkshopContext";
import { useTerminal } from "./TerminalContext";
import * as progress from "../labspace/progress";

// Records the learner's progress through a lab's author-defined steps, exposes
// it to the UI (nav check-marks, resume), and — when the lab opts in — reports
// anonymous events and live presence to a `pulse` backend.
//
// A "step" is completed when a scenario tagged `completes: <step-id>` fires; the
// engine surfaces that on the command outcome, TerminalPanel re-broadcasts it as
// a `step` event, and this context records it in the local progress store.
//
// TWO layers, each independently optional:
//   1. Local progress — works with ONLY a step catalog in labspace.yaml, no
//      network. Powers the learner's own check-marks and resume.
//   2. Backend reporting — layered on top and gated ENTIRELY on
//      `workshop.tracking?.endpoint`. With no tracking config, this context
//      makes zero network calls. Events go out fire-and-forget (sendBeacon,
//      with a keepalive fetch fallback); presence is polled back.

const TrackingContext = createContext(null);

const HEARTBEAT_MS = 15_000;
const PRESENCE_POLL_MS = 10_000;

export function TrackingContextProvider({ children }) {
  const workshop = useWorkshop();
  const { subscribe } = useTerminal();
  const { activeSection } = useActiveSection();

  const labKey = workshop.labKey || "";
  const tracking = workshop.tracking || null;
  const endpoint = tracking?.endpoint
    ? tracking.endpoint.replace(/\/+$/, "")
    : null;
  const presenceEnabled = Boolean(endpoint) && tracking?.presence !== false;
  const allowName = tracking?.identity !== "anonymous";
  const labId = tracking?.labId || labKey;
  const labVersion = workshop.version || null;
  const meta = useMemo(() => ({ labId, labVersion }), [labId, labVersion]);

  // Actor identity is created synchronously (localStorage) so events can carry
  // it from the very first render. The provider remounts per lab (keyed on
  // labId in AppRoute), so this initializer re-runs when the lab changes.
  const identityRef = useRef(null);
  if (!identityRef.current)
    identityRef.current = progress.getActor(labKey, meta);

  const [completed, setCompleted] = useState(
    () => progress.loadProgress(labKey, meta).completed || {},
  );
  const [presence, setPresence] = useState(null);

  const activeSectionId = activeSection?.id;
  const activeSectionRef = useRef(activeSectionId);
  activeSectionRef.current = activeSectionId;

  // ── Backend event emit (no-op when the lab has no tracking endpoint) ────────
  const emit = useCallback(
    (event, extra = {}) => {
      if (!endpoint) return;
      const { actor, avatar } = identityRef.current || {};
      const body = JSON.stringify({
        labId,
        labVersion,
        sessionId: actor?.id,
        actor: actor
          ? { id: actor.id, name: allowName ? actor.name : undefined }
          : undefined,
        avatar,
        event,
        ts: new Date().toISOString(),
        ...extra,
      });
      const url = `${endpoint}/events`;
      try {
        // Plain-string beacon → text/plain, a CORS-safelisted type, so no
        // preflight. The server parses the body as JSON regardless.
        if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
      } catch {
        /* fall through to fetch */
      }
      try {
        fetch(url, {
          method: "POST",
          body,
          keepalive: true,
          headers: { "Content-Type": "text/plain" },
        }).catch(() => {});
      } catch {
        /* best-effort telemetry */
      }
    },
    [endpoint, labId, labVersion, allowName],
  );

  // Record completions as `step` events arrive from any terminal; also emit
  // step_completed, and lab_completed once every cataloged step is done.
  const labCompleteSentRef = useRef(false);
  const totalSteps = useMemo(
    () =>
      (workshop.sections || []).reduce(
        (n, s) => n + (s.steps ? s.steps.length : 0),
        0,
      ),
    [workshop],
  );

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event) => {
      if (event.type === "reset") {
        emit("reset");
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
        emit("step_completed", {
          stepId: event.stepId,
          sectionId: activeSectionRef.current,
        });
      }
      if (
        totalSteps > 0 &&
        Object.keys(next).length >= totalSteps &&
        !labCompleteSentRef.current
      ) {
        labCompleteSentRef.current = true;
        emit("lab_completed");
      }
    });
  }, [subscribe, labKey, emit, totalSteps]);

  // lab_started once per mount.
  useEffect(() => {
    if (!endpoint) return;
    emit("lab_started", { sectionId: activeSectionRef.current });
  }, [endpoint, emit]);

  // section_viewed whenever the active section changes.
  useEffect(() => {
    if (!endpoint || !activeSectionId) return;
    emit("section_viewed", { sectionId: activeSectionId });
  }, [endpoint, activeSectionId, emit]);

  // Heartbeat while the tab is visible; a leave beacon on unload.
  useEffect(() => {
    if (!endpoint) return undefined;
    const beat = () => {
      if (document.visibilityState === "visible") {
        emit("heartbeat", { sectionId: activeSectionRef.current });
      }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onHide = () => emit("leave");
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      emit("leave");
    };
  }, [endpoint, emit]);

  // Poll live presence back for the (Phase 3) presence UI.
  useEffect(() => {
    if (!presenceEnabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `${endpoint}/presence?labId=${encodeURIComponent(labId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPresence(data);
      } catch {
        /* presence is best-effort */
      }
    };
    poll();
    const timer = setInterval(poll, PRESENCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [presenceEnabled, endpoint, labId]);

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
      // Whether this lab has any tracked steps at all — lets the UI hide
      // progress affordances entirely for labs that opt out.
      hasSteps: totalSteps > 0,
      // Live presence from the backend (null when not configured / not yet
      // polled). Consumed by the Phase 3 presence UI.
      presence,
      presenceEnabled,
    }),
    [
      completed,
      isStepComplete,
      isSectionComplete,
      resetProgress,
      totalSteps,
      presence,
      presenceEnabled,
    ],
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

export const useTracking = () => useContext(TrackingContext);
