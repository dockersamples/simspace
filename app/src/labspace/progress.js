// Learner progress store. Records which author-defined steps a learner has
// completed, kept in localStorage under a per-lab key so several labs on one
// origin stay isolated.
//
// This store is deliberately SEPARATE from the engine snapshot
// (`simspace:engine`, owned by TerminalContext): pressing "Reset lab" re-seeds
// the exercise state but must NOT wipe the learner's completion record. A
// dedicated "Reset progress" action (resetProgress) clears it explicitly.
//
// Everything here is local to the browser — no network, and no PII unless the
// learner chooses to enter a display name. The random `actor.id` is a
// per-browser handle, not an identity. This module is app-layer (not the
// engine), so time and randomness are allowed here.

import { scopedKey } from "./storage";

const PROGRESS_KEY = "simspace:progress";

// Deterministic anonymous avatar derived from a session id: a color + emoji
// pair that is stable within a browser and meaningless across browsers. Used
// by the (later) live-presence UI and to give the learner a consistent handle.
const AVATAR_EMOJI = [
  "🐳",
  "🦈",
  "🐙",
  "🦭",
  "🐢",
  "🦀",
  "🐠",
  "🦑",
  "🦞",
  "🐡",
  "🦐",
  "🐬",
];
const AVATAR_COLORS = [
  "#0db7ed",
  "#2496ed",
  "#8a3ffc",
  "#ee5396",
  "#ff832b",
  "#24a148",
  "#009d9a",
  "#a56eff",
];

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

export function avatarFor(id) {
  const h = hashString(id || "anon");
  return {
    emoji: AVATAR_EMOJI[h % AVATAR_EMOJI.length],
    color: AVATAR_COLORS[(h >> 8) % AVATAR_COLORS.length],
  };
}

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `s-${hashString(`${Date.now()}-${Math.random()}`).toString(36)}`;
}

function keyFor(labKey) {
  return scopedKey(PROGRESS_KEY, labKey);
}

function read(labKey) {
  try {
    const raw = localStorage.getItem(keyFor(labKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(labKey, store) {
  try {
    localStorage.setItem(keyFor(labKey), JSON.stringify(store));
  } catch {
    /* storage may be full or unavailable — progress is best-effort */
  }
}

function nowIso() {
  return new Date().toISOString();
}

// Loads (or creates) the progress store for a lab. When the stored `labVersion`
// no longer matches the lab's current version, the completion set is cleared
// (the lab's steps may have changed) while the actor identity is preserved.
export function loadProgress(labKey, { labId, labVersion } = {}) {
  let store = read(labKey);
  const ts = nowIso();

  if (!store || typeof store !== "object") {
    store = {
      labId: labId || labKey || "",
      labVersion: labVersion || null,
      actor: { id: randomId() },
      startedAt: ts,
      lastActiveAt: ts,
      completed: {},
    };
    write(labKey, store);
    return store;
  }

  // Backfill fields that may be missing from an older record.
  if (!store.actor || !store.actor.id) store.actor = { id: randomId() };
  if (!store.completed || typeof store.completed !== "object") {
    store.completed = {};
  }

  // Invalidate completion when the lab version changed (steps may differ).
  if (labVersion != null && store.labVersion !== labVersion) {
    store.completed = {};
    store.labVersion = labVersion;
  }
  if (labId) store.labId = labId;
  store.lastActiveAt = ts;
  write(labKey, store);
  return store;
}

// Returns the learner's actor + deterministic avatar, creating the store if
// needed. Used by the presence layer and any "you" affordance.
export function getActor(labKey, meta) {
  const store = loadProgress(labKey, meta);
  return { actor: store.actor, avatar: avatarFor(store.actor.id) };
}

// Sets (or clears) the learner's optional display name. Passing a falsy value
// removes it, returning to fully anonymous.
export function setActorName(labKey, name) {
  const store = loadProgress(labKey);
  store.actor = { ...store.actor, name: name || undefined };
  write(labKey, store);
  return store.actor;
}

// Marks a step complete. Idempotent: re-running the same command re-asserts
// completion harmlessly and does not overwrite the original timestamp. Returns
// the updated `completed` map (a new object) when it changed, else the existing
// map unchanged so callers can bail on no-op.
export function markComplete(labKey, stepId, meta = {}) {
  if (!stepId) return read(labKey)?.completed || {};
  const store = loadProgress(labKey);
  store.lastActiveAt = nowIso();
  if (store.completed[stepId]) {
    write(labKey, store);
    return store.completed;
  }
  store.completed = {
    ...store.completed,
    [stepId]: {
      at: nowIso(),
      command: meta.command,
      scenario: meta.scenario,
    },
  };
  write(labKey, store);
  return store.completed;
}

// The current set of completed step ids (as a plain object keyed by id).
export function completedSteps(labKey) {
  return read(labKey)?.completed || {};
}

// Clears the completion record but keeps the actor identity. This is the
// explicit "Reset progress" action — distinct from the exercise "Reset lab".
export function resetProgress(labKey) {
  const store = read(labKey);
  if (!store) return {};
  store.completed = {};
  store.lastActiveAt = nowIso();
  write(labKey, store);
  return store.completed;
}
