// Routes incoming events to the two stores. Each event is a projection source:
// meaningful events persist to the durable log (analytics) AND update live
// presence; heartbeats only refresh presence; leaves only remove presence.

import type { EventLog } from "./store/sqlite.js";
import { PresenceStore, START_MILESTONE } from "./store/presence.js";
import { EVENT_NAMES, type IncomingEvent } from "./types.js";

const EVENT_SET = new Set<string>(EVENT_NAMES);

/** Validates one raw item into an IncomingEvent, or null if malformed. */
export function parseEvent(raw: unknown): IncomingEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.labId !== "string" || !o.labId) return null;
  if (typeof o.sessionId !== "string" || !o.sessionId) return null;
  if (typeof o.event !== "string" || !EVENT_SET.has(o.event)) return null;

  const actor =
    o.actor && typeof o.actor === "object"
      ? (o.actor as Record<string, unknown>)
      : undefined;
  const avatar =
    o.avatar && typeof o.avatar === "object"
      ? (o.avatar as Record<string, unknown>)
      : undefined;

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return {
    labId: o.labId,
    labVersion: str(o.labVersion) ?? null,
    sessionId: o.sessionId,
    event: o.event as IncomingEvent["event"],
    ts: str(o.ts),
    sectionId: str(o.sectionId),
    stepId: str(o.stepId),
    actor: actor ? { id: str(actor.id), name: str(actor.name) } : undefined,
    avatar: avatar
      ? { emoji: str(avatar.emoji), color: str(avatar.color) }
      : undefined,
  };
}

/** True for events that belong in the durable analytics log. */
function isDurable(event: IncomingEvent["event"]): boolean {
  return event !== "heartbeat" && event !== "leave";
}

export function ingestEvent(
  e: IncomingEvent,
  log: EventLog,
  presence: PresenceStore,
  tsServer: string,
): void {
  // Durable analytics log.
  if (isDurable(e.event)) log.append(e, tsServer);

  // Live presence projection.
  const identity = {
    name: e.actor?.name,
    emoji: e.avatar?.emoji,
    color: e.avatar?.color,
  };

  switch (e.event) {
    case "leave":
      presence.remove(e.labId, e.sessionId);
      return;
    case "step_completed":
      presence.touch(e.labId, e.sessionId, {
        ...identity,
        sectionId: e.sectionId,
        // A completed step advances the learner's milestone position.
        milestone: e.stepId || START_MILESTONE,
      });
      return;
    case "section_viewed":
      presence.touch(e.labId, e.sessionId, {
        ...identity,
        sectionId: e.sectionId,
      });
      return;
    case "lab_started":
    case "heartbeat":
    case "lab_completed":
      presence.touch(e.labId, e.sessionId, {
        ...identity,
        sectionId: e.sectionId,
      });
      return;
    case "reset":
      // Frustration signal; recorded durably but doesn't change presence.
      return;
  }
}
