// Ephemeral presence: who is in each lab right now, and where. Held entirely in
// memory with a per-session TTL — presence is a heartbeat, not a record, so it
// is fine to lose on restart. (Swap for Redis with key TTLs to run replicas.)

import type { PresenceAggregate, PresenceAvatar } from "../types.js";

interface Session {
  sessionId: string;
  name?: string;
  emoji?: string;
  color?: string;
  /** Reading position: the section the learner is currently viewing. */
  sectionId?: string;
  /** Progress position: last completed step id, or "start" before any. */
  milestone: string;
  /** Epoch ms of the last heartbeat/event from this session. */
  lastSeen: number;
}

const START = "start";

export class PresenceStore {
  // labId -> (sessionId -> Session)
  private labs = new Map<string, Map<string, Session>>();

  constructor(
    private ttlMs: number,
    private sampleSize: number,
    private now: () => number = () => Date.now(),
  ) {}

  private lab(labId: string): Map<string, Session> {
    let m = this.labs.get(labId);
    if (!m) {
      m = new Map();
      this.labs.set(labId, m);
    }
    return m;
  }

  private session(labId: string, sessionId: string): Session {
    const m = this.lab(labId);
    let s = m.get(sessionId);
    if (!s) {
      s = { sessionId, milestone: START, lastSeen: this.now() };
      m.set(sessionId, s);
    }
    return s;
  }

  /** Refresh a session's liveness and (optionally) identity/position. */
  touch(
    labId: string,
    sessionId: string,
    patch: Partial<Omit<Session, "sessionId" | "lastSeen">> = {},
  ): void {
    const s = this.session(labId, sessionId);
    if (patch.name !== undefined) s.name = patch.name || undefined;
    if (patch.emoji !== undefined) s.emoji = patch.emoji;
    if (patch.color !== undefined) s.color = patch.color;
    if (patch.sectionId !== undefined) s.sectionId = patch.sectionId;
    if (patch.milestone !== undefined) s.milestone = patch.milestone;
    s.lastSeen = this.now();
  }

  /** Remove a session immediately (e.g. on a `leave` beacon). */
  remove(labId: string, sessionId: string): void {
    this.labs.get(labId)?.delete(sessionId);
  }

  /** Drop sessions whose TTL has elapsed; also called lazily before reads. */
  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [labId, m] of this.labs) {
      for (const [sid, s] of m) {
        if (s.lastSeen < cutoff) m.delete(sid);
      }
      if (m.size === 0) this.labs.delete(labId);
    }
  }

  /** Live presence for one lab. */
  aggregate(labId: string): PresenceAggregate {
    this.sweep();
    const m = this.labs.get(labId);
    const perSection: Record<string, number> = {};
    const perMilestone: Record<string, number> = {};
    const avatars: PresenceAvatar[] = [];
    if (m) {
      for (const s of m.values()) {
        if (s.sectionId) {
          perSection[s.sectionId] = (perSection[s.sectionId] ?? 0) + 1;
        }
        perMilestone[s.milestone] = (perMilestone[s.milestone] ?? 0) + 1;
        if (avatars.length < this.sampleSize) {
          avatars.push({
            id: s.sessionId,
            name: s.name,
            emoji: s.emoji,
            color: s.color,
            sectionId: s.sectionId,
            milestone: s.milestone,
          });
        }
      }
    }
    return {
      labId,
      total: m ? m.size : 0,
      perSection,
      perMilestone,
      avatars,
    };
  }
}

export const START_MILESTONE = START;
