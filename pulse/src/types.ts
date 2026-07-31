// Shared shapes for the pulse service. The event envelope mirrors what the
// static lab app sends (see app/src/context/TrackingContext.jsx); the aggregate
// shapes are what the app reads back for live presence.

/** The events a lab may emit. `heartbeat`/`leave` touch presence only. */
export type EventName =
  | "lab_started"
  | "section_viewed"
  | "step_completed"
  | "lab_completed"
  | "reset"
  | "heartbeat"
  | "leave";

export const EVENT_NAMES: EventName[] = [
  "lab_started",
  "section_viewed",
  "step_completed",
  "lab_completed",
  "reset",
  "heartbeat",
  "leave",
];

/** A deterministic anonymous avatar, generated client-side from the session id. */
export interface Avatar {
  emoji?: string;
  color?: string;
}

/** One event as received from a lab. All fields beyond the envelope are optional. */
export interface IncomingEvent {
  labId: string;
  labVersion?: string | null;
  sessionId: string;
  event: EventName;
  /** Client-side ISO timestamp; the server also stamps its own receive time. */
  ts?: string;
  sectionId?: string;
  stepId?: string;
  actor?: { id?: string; name?: string };
  avatar?: Avatar;
}

/** A single present learner, as surfaced in the presence aggregate. */
export interface PresenceAvatar {
  id: string;
  name?: string;
  emoji?: string;
  color?: string;
  sectionId?: string;
  /** Last completed step id, or "start" before any step. */
  milestone?: string;
}

/** Live presence for one lab: who's here now, and where. */
export interface PresenceAggregate {
  /** The deployment origin this lab's data is namespaced under. */
  origin: string;
  labId: string;
  total: number;
  /** Active sessions by reading position (current section). */
  perSection: Record<string, number>;
  /** Active sessions by progress position (last completed step; "start" if none). */
  perMilestone: Record<string, number>;
  /** A bounded sample of present learners for avatar display. */
  avatars: PresenceAvatar[];
}
