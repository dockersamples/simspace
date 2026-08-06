// Durable, append-only event log backed by SQLite. This is the analytics side:
// every persisted event is a row, and cumulative stats (completion funnel,
// per-step counts, lab completions) are plain SQL over it.
//
// Presence is NOT stored here — that lives in the in-memory PresenceStore. Only
// meaningful, durable events land in this log (heartbeats/leaves do not).
//
// Uses Node's built-in `node:sqlite` rather than better-sqlite3: same file
// format and near-identical API, but no native addon to compile, which keeps a
// C++ toolchain out of the image entirely. Needs Node >= 22.13 (where the
// module became available unflagged); the images run 24.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { IncomingEvent } from "../types.js";

// node:sqlite types every column as SQLOutputValue, so reads come back as
// `Record<string, ...>` and need a hop through `unknown` to land on the shaped
// row types below. The queries and their interfaces are declared side by side,
// so this is the same trust boundary better-sqlite3's generics gave us.
const rows = <T>(r: unknown): T[] => r as T[];
const row = <T>(r: unknown): T => r as T;

export interface StepStat {
  stepId: string;
  completions: number;
  distinctSessions: number;
}

export interface LabStats {
  origin: string;
  labId: string;
  starts: number;
  completions: number;
  steps: StepStat[];
  sections: { sectionId: string; views: number; distinctSessions: number }[];
}

/** One tracked lab, keyed by (origin, labId) — a row of the /labs listing. */
export interface LabSummary {
  /** The deployment origin the events arrived from ("unknown" for non-browser callers). */
  origin: string;
  labId: string;
  events: number;
  starts: number;
  completions: number;
  firstSeen: string;
  lastSeen: string;
}

export class EventLog {
  private db: DatabaseSync;
  private insertStmt: StatementSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // `exec` rather than a pragma helper — node:sqlite has no `.pragma()`.
    // A no-op for :memory:, which reports journal_mode "memory" regardless.
    this.db.exec(`PRAGMA journal_mode = WAL`);
    // `origin` namespaces every row by the deployment the event came from, so
    // the same labId served from two different sites never collides.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        origin      TEXT,
        lab_id      TEXT NOT NULL,
        lab_version TEXT,
        session_id  TEXT NOT NULL,
        actor_id    TEXT,
        event       TEXT NOT NULL,
        section_id  TEXT,
        step_id     TEXT,
        ts_client   TEXT,
        ts_server   TEXT NOT NULL
      );
    `);
    // Migrate a pre-origin database: add the column (legacy rows get NULL,
    // surfaced as "unknown") so an existing volume keeps working after upgrade.
    // MUST run before the indexes below, which reference `origin` — on an
    // existing DB the CREATE TABLE above is a no-op, so the column only exists
    // once this ALTER has run.
    const hasOrigin = rows<{ name: string }>(
      this.db.prepare(`PRAGMA table_info(events)`).all(),
    ).some((c) => c.name === "origin");
    if (!hasOrigin) this.db.exec(`ALTER TABLE events ADD COLUMN origin TEXT`);

    // Indexes lead with `origin` because every read is scoped by it.
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_origin_lab ON events (origin, lab_id, event);
      CREATE INDEX IF NOT EXISTS idx_events_origin_lab_step ON events (origin, lab_id, step_id);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO events
        (origin, lab_id, lab_version, session_id, actor_id, event, section_id, step_id, ts_client, ts_server)
      VALUES
        (@origin, @lab_id, @lab_version, @session_id, @actor_id, @event, @section_id, @step_id, @ts_client, @ts_server)
    `);
  }

  append(e: IncomingEvent, tsServer: string, origin: string): void {
    this.insertStmt.run({
      origin,
      lab_id: e.labId,
      lab_version: e.labVersion ?? null,
      session_id: e.sessionId,
      actor_id: e.actor?.id ?? null,
      event: e.event,
      section_id: e.sectionId ?? null,
      step_id: e.stepId ?? null,
      ts_client: e.ts ?? null,
      ts_server: tsServer,
    });
  }

  /**
   * Cumulative stats for a lab — the instructor view. Includes drop-off signal
   * (per-step distinct-session counts), which is why the /stats endpoint that
   * serves this is token-gated and never called by the lab UI.
   */
  // `sinceIso`, when given, scopes every count to events at or after that UTC
  // timestamp — the time-window feature. ts_server is stored as a UTC ISO
  // string, so a lexicographic `>=` compare is a correct time compare. Passing
  // the cutoff as `(? IS NULL OR ts_server >= ?)` keeps one query for both the
  // windowed and all-time (sinceIso = undefined → null) cases.
  stats(origin: string, labId: string, sinceIso?: string): LabStats {
    const since = sinceIso ?? null;

    const count = (event: string) =>
      row<{ n: number }>(
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT session_id) AS n
               FROM events
              WHERE origin = ? AND lab_id = ? AND event = ? AND (? IS NULL OR ts_server >= ?)`,
          )
          .get(origin, labId, event, since, since),
      ).n;

    const steps = rows<StepStat>(
      this.db
        .prepare(
          `SELECT step_id AS stepId,
                COUNT(*) AS completions,
                COUNT(DISTINCT session_id) AS distinctSessions
           FROM events
          WHERE origin = ? AND lab_id = ? AND event = 'step_completed' AND step_id IS NOT NULL
                AND (? IS NULL OR ts_server >= ?)
          GROUP BY step_id
          ORDER BY distinctSessions DESC`,
        )
        .all(origin, labId, since, since),
    );

    const sections = rows<{
      sectionId: string;
      views: number;
      distinctSessions: number;
    }>(
      this.db
        .prepare(
          `SELECT section_id AS sectionId,
                COUNT(*) AS views,
                COUNT(DISTINCT session_id) AS distinctSessions
           FROM events
          WHERE origin = ? AND lab_id = ? AND event = 'section_viewed' AND section_id IS NOT NULL
                AND (? IS NULL OR ts_server >= ?)
          GROUP BY section_id
          ORDER BY distinctSessions DESC`,
        )
        .all(origin, labId, since, since),
    );

    return {
      origin,
      labId,
      starts: count("lab_started"),
      completions: count("lab_completed"),
      steps,
      sections,
    };
  }

  /** Public, aggregate-only count for the catalog page ("N completed this lab"). */
  completedCount(origin: string, labId: string): number {
    return row<{ n: number }>(
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE origin = ? AND lab_id = ? AND event = 'lab_completed'`,
        )
        .get(origin, labId),
    ).n;
  }

  /**
   * Every tracked lab, one row per (origin, labId), most-recently-active first.
   * Backs the token-gated /labs endpoint. Legacy rows written before the origin
   * column are surfaced under "unknown" so nothing is silently dropped.
   */
  labs(): LabSummary[] {
    return rows<LabSummary>(
      this.db
        .prepare(
          `SELECT COALESCE(origin, 'unknown') AS origin,
                lab_id AS labId,
                COUNT(*) AS events,
                COUNT(DISTINCT CASE WHEN event = 'lab_started'  THEN session_id END) AS starts,
                COUNT(DISTINCT CASE WHEN event = 'lab_completed' THEN session_id END) AS completions,
                MIN(ts_server) AS firstSeen,
                MAX(ts_server) AS lastSeen
           FROM events
          GROUP BY COALESCE(origin, 'unknown'), lab_id
          ORDER BY lastSeen DESC`,
        )
        .all(),
    );
  }

  close(): void {
    this.db.close();
  }
}
