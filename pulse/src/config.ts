// Runtime configuration, all from environment variables so the same image runs
// anywhere. Every value has a sensible default for local `npm run dev`.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** HTTP port. */
  port: num("PORT", 8888),

  /** SQLite file for the durable event log. ":memory:" for an ephemeral store. */
  dbPath: process.env.DB_PATH || "./data/pulse.db",

  /**
   * How long after its last heartbeat a session is still counted as "present".
   * Clients heartbeat ~every 15s, so ~30s tolerates one missed beat.
   */
  presenceTtlMs: num("PRESENCE_TTL_MS", 30_000),

  /** Max avatars returned in a presence aggregate (rest folded into the count). */
  presenceSampleSize: num("PRESENCE_SAMPLE_SIZE", 8),

  /**
   * Allowed CORS origin(s). "*" (default) suits a public, anonymous, append-only
   * ingest. Set to a specific origin to lock it down.
   */
  corsOrigin: process.env.CORS_ORIGIN || "*",

  /** Max request body size for ingest (bytes). */
  maxBodyBytes: num("MAX_BODY_BYTES", 64 * 1024),

  /** Fixed-window rate limit: max ingest requests per IP per window. */
  rateLimitMax: num("RATE_LIMIT_MAX", 120),
  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),

  /**
   * Bearer token gating GET /stats (the only endpoint exposing cumulative
   * drop-off). Unset → /stats is disabled entirely (returns 404), so instructor
   * data is never accidentally public.
   */
  statsToken: process.env.STATS_TOKEN || "",
};

export type Config = typeof config;
