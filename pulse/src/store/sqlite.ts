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
  labId: string;
  starts: number;
  completions: number;
  steps: StepStat[];
  sections: { sectionId: string; views: number; distinctSessions: number }[];
}

export class EventLog {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
      CREATE INDEX IF NOT EXISTS idx_events_lab ON events (lab_id, event);
      CREATE INDEX IF NOT EXISTS idx_events_lab_step ON events (lab_id, step_id);
    `);
    this.insertStmt = this.db.prepare(`
      INSERT INTO events
        (lab_id, lab_version, session_id, actor_id, event, section_id, step_id, ts_client, ts_server)
      VALUES
        (@lab_id, @lab_version, @session_id, @actor_id, @event, @section_id, @step_id, @ts_client, @ts_server)
    `);
  }

  append(e: IncomingEvent, tsServer: string): void {
    this.insertStmt.run({
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
  stats(labId: string, sinceIso?: string): LabStats {
    const since = sinceIso ?? null;

    const count = (event: string) =>
      (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT session_id) AS n
               FROM events
              WHERE lab_id = ? AND event = ? AND (? IS NULL OR ts_server >= ?)`,
          )
          .get(labId, event, since, since) as { n: number }
      ).n;

    const steps = this.db
      .prepare(
        `SELECT step_id AS stepId,
                COUNT(*) AS completions,
                COUNT(DISTINCT session_id) AS distinctSessions
           FROM events
          WHERE lab_id = ? AND event = 'step_completed' AND step_id IS NOT NULL
                AND (? IS NULL OR ts_server >= ?)
          GROUP BY step_id
          ORDER BY distinctSessions DESC`,
      )
      .all(labId, since, since) as StepStat[];

    const sections = this.db
      .prepare(
        `SELECT section_id AS sectionId,
                COUNT(*) AS views,
                COUNT(DISTINCT session_id) AS distinctSessions
           FROM events
          WHERE lab_id = ? AND event = 'section_viewed' AND section_id IS NOT NULL
                AND (? IS NULL OR ts_server >= ?)
          GROUP BY section_id
          ORDER BY distinctSessions DESC`,
      )
      .all(labId, since, since) as {
      sectionId: string;
      views: number;
      distinctSessions: number;
    }[];

    return {
      labId,
      starts: count("lab_started"),
      completions: count("lab_completed"),
      steps,
      sections,
    };
  }

  /** Public, aggregate-only count for the catalog page ("N completed this lab"). */
  completedCount(labId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE lab_id = ? AND event = 'lab_completed'`,
        )
        .get(labId) as { n: number }
    ).n;
  }

  close(): void {
    this.db.close();
  }
}
