// Durable, append-only event log backed by SQLite (better-sqlite3). This is the
// analytics side: every persisted event is a row, and cumulative stats
// (completion funnel, per-step counts, lab completions) are plain SQL over it.
//
// Presence is NOT stored here — that lives in the in-memory PresenceStore. Only
// meaningful, durable events land in this log (heartbeats/leaves do not).

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { IncomingEvent } from "../types.js";

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
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    // `origin` namespaces every row by the deployment the event came from, so
    // the same labId served from two different sites never collides. It's the
    // leading column of both indexes because every read is scoped by it.
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
      CREATE INDEX IF NOT EXISTS idx_events_origin_lab ON events (origin, lab_id, event);
      CREATE INDEX IF NOT EXISTS idx_events_origin_lab_step ON events (origin, lab_id, step_id);
    `);
    // Migrate a pre-origin database: add the column (legacy rows get NULL,
    // surfaced as "unknown") so an existing volume keeps working after upgrade.
    const hasOrigin = (
      this.db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]
    ).some((c) => c.name === "origin");
    if (!hasOrigin) this.db.exec(`ALTER TABLE events ADD COLUMN origin TEXT`);

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
      (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT session_id) AS n
               FROM events
              WHERE origin = ? AND lab_id = ? AND event = ? AND (? IS NULL OR ts_server >= ?)`,
          )
          .get(origin, labId, event, since, since) as { n: number }
      ).n;

    const steps = this.db
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
      .all(origin, labId, since, since) as StepStat[];

    const sections = this.db
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
      .all(origin, labId, since, since) as {
      sectionId: string;
      views: number;
      distinctSessions: number;
    }[];

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
    return (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE origin = ? AND lab_id = ? AND event = 'lab_completed'`,
        )
        .get(origin, labId) as { n: number }
    ).n;
  }

  /**
   * Every tracked lab, one row per (origin, labId), most-recently-active first.
   * Backs the token-gated /labs endpoint. Legacy rows written before the origin
   * column are surfaced under "unknown" so nothing is silently dropped.
   */
  labs(): LabSummary[] {
    return this.db
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
      .all() as LabSummary[];
  }

  close(): void {
    this.db.close();
  }
}
