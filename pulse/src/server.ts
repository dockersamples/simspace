// The HTTP surface: a tiny node:http server (no framework) exposing ingest,
// live presence, gated stats, and a public catalog count. CORS-open for ingest
// and presence (the lab is a different origin); /stats is token-gated.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { EventLog } from "./store/sqlite.js";
import type { PresenceStore } from "./store/presence.js";
import { ingestEvent, parseEvent } from "./ingest.js";

interface Deps {
  config: Config;
  log: EventLog;
  presence: PresenceStore;
  now?: () => number;
}

// Fixed-window rate limiter keyed by client IP. Coarse but enough to blunt
// abuse of a public, unauthenticated ingest endpoint.
function makeRateLimiter(max: number, windowMs: number, now: () => number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (ip: string): boolean => {
    const t = now();
    const cur = hits.get(ip);
    if (!cur || t >= cur.resetAt) {
      hits.set(ip, { count: 1, resetAt: t + windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= max;
  };
}

function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// The deployment a request comes from. All lab data is namespaced by this so
// the same labId served from two different sites never collides — and it tells
// us where the traffic originates. Browsers set `Origin` on every cross-origin
// request we serve here (the ingest POST/beacon, presence GET, and the SSE
// stream), so a lab's writes and its reads resolve to the same value. Falls
// back to the Referer's origin, then to "unknown" for non-browser callers
// (curl, the smoke test) so their reads and writes still line up.
function requestOrigin(req: IncomingMessage): string {
  const o = req.headers.origin;
  if (typeof o === "string" && o && o !== "null") return o;
  const ref = req.headers.referer;
  if (typeof ref === "string" && ref) {
    try {
      return new URL(ref).origin;
    } catch {
      /* malformed Referer — fall through */
    }
  }
  return "unknown";
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createApp({ config, log, presence, now = () => Date.now() }: Deps) {
  const allow = makeRateLimiter(config.rateLimitMax, config.rateLimitWindowMs, now);

  // CORS allowlist. "*" allows any origin (the open default). Otherwise the
  // config is a comma-separated set of exact origins; a request's Origin is
  // reflected back only if it's on the list, so one endpoint can serve several
  // deployments without opening up to the whole web.
  const corsAllowAll = config.corsOrigin.trim() === "*";
  const corsAllowlist = new Set(
    config.corsOrigin
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // The value to send for Access-Control-Allow-Origin, or null to send none
  // (which makes a browser block a disallowed cross-origin caller).
  const allowOriginFor = (req: IncomingMessage): string | null => {
    if (corsAllowAll) return "*";
    const o = req.headers.origin;
    if (typeof o === "string" && corsAllowlist.has(o)) return o;
    return null;
  };

  // Shared gate for the instructor-only endpoints (/stats, /labs): accepts the
  // token as a Bearer header or a `?token=` query param.
  const authorized = (req: IncomingMessage, url: URL): boolean => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : url.searchParams.get("token") || "";
    return token === config.statsToken;
  };

  return createServer(async (req, res) => {
    // Defined per-request so CORS can reflect this request's Origin. When the
    // allowlist mode is active the response varies by Origin, so mark it so
    // shared caches don't serve one origin's headers to another.
    const cors = (res: ServerResponse) => {
      const allowed = allowOriginFor(req);
      if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
      if (!corsAllowAll) res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Max-Age", "86400");
    };

    const json = (res: ServerResponse, status: number, body: unknown) => {
      cors(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };

    try {
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && path === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      // ── Ingest ────────────────────────────────────────────────────────────
      if (req.method === "POST" && path === "/events") {
        if (!allow(clientIp(req))) {
          json(res, 429, { error: "rate limited" });
          return;
        }
        let text: string;
        try {
          text = await readBody(req, config.maxBodyBytes);
        } catch {
          json(res, 413, { error: "payload too large" });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          json(res, 400, { error: "invalid JSON" });
          return;
        }
        const items = Array.isArray(payload) ? payload : [payload];
        const tsServer = new Date(now()).toISOString();
        const origin = requestOrigin(req);
        let accepted = 0;
        for (const raw of items) {
          const e = parseEvent(raw);
          if (!e) continue;
          ingestEvent(e, log, presence, tsServer, origin);
          accepted += 1;
        }
        json(res, 202, { accepted, received: items.length });
        return;
      }

      // ── Live presence (public) ──────────────────────────────────────────────
      if (req.method === "GET" && path === "/presence") {
        const labId = url.searchParams.get("labId");
        if (!labId) {
          json(res, 400, { error: "labId required" });
          return;
        }
        json(res, 200, presence.aggregate(requestOrigin(req), labId));
        return;
      }

      // ── Live presence stream (public, SSE) ────────────────────────────────────
      // Pushes the presence aggregate on connect and every few seconds after,
      // so clients get smoother updates than polling. Clients that can't use
      // SSE fall back to GET /presence.
      if (req.method === "GET" && path === "/stream") {
        const labId = url.searchParams.get("labId");
        if (!labId) {
          json(res, 400, { error: "labId required" });
          return;
        }
        const origin = requestOrigin(req);
        const allowed = allowOriginFor(req);
        if (allowed) res.setHeader("Access-Control-Allow-Origin", allowed);
        if (!corsAllowAll) res.setHeader("Vary", "Origin");
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);
        const send = () => {
          res.write(
            `data: ${JSON.stringify(presence.aggregate(origin, labId))}\n\n`,
          );
        };
        send();
        const timer = setInterval(send, 3000);
        req.on("close", () => clearInterval(timer));
        return;
      }

      // ── Catalog count (public, aggregate-only) ───────────────────────────────
      if (req.method === "GET" && path === "/completed") {
        const labId = url.searchParams.get("labId");
        if (!labId) {
          json(res, 400, { error: "labId required" });
          return;
        }
        const origin = requestOrigin(req);
        json(res, 200, {
          labId,
          completed: log.completedCount(origin, labId),
        });
        return;
      }

      // ── Cumulative stats (instructor-only, token-gated) ──────────────────────
      if (req.method === "GET" && path === "/stats") {
        if (!config.statsToken) {
          json(res, 404, { error: "stats disabled" });
          return;
        }
        if (!authorized(req, url)) {
          json(res, 401, { error: "unauthorized" });
          return;
        }
        const labId = url.searchParams.get("labId");
        if (!labId) {
          json(res, 400, { error: "labId required" });
          return;
        }
        // Namespaced by origin, like ingest. The instructor dashboard is served
        // from the same origin as its labs, so the derived origin already
        // matches; an operator inspecting another deployment (e.g. one they
        // found via /labs) can target it explicitly with `?origin=`.
        const origin = url.searchParams.get("origin") || requestOrigin(req);
        // Optional time window: `sinceMs` is a lookback in milliseconds. The
        // cutoff is computed from the server clock on every request, so the
        // window slides (a client's "last 3h" always means the last 3h) and
        // there's no client/server clock-skew. Absent/0 → all-time.
        const sinceMs = Number(url.searchParams.get("sinceMs"));
        const sinceIso =
          Number.isFinite(sinceMs) && sinceMs > 0
            ? new Date(now() - sinceMs).toISOString()
            : undefined;
        json(res, 200, log.stats(origin, labId, sinceIso));
        return;
      }

      // ── Tracked-lab inventory (instructor-only, token-gated) ─────────────────
      // Every (origin, labId) pair the service has seen, enriched with the live
      // "here now" count. Lets an operator discover what a shared endpoint is
      // tracking and where from, then drill into one with /stats?origin=…
      if (req.method === "GET" && path === "/labs") {
        if (!config.statsToken) {
          json(res, 404, { error: "stats disabled" });
          return;
        }
        if (!authorized(req, url)) {
          json(res, 401, { error: "unauthorized" });
          return;
        }
        const labs = log.labs().map((l) => ({
          ...l,
          hereNow: presence.total(l.origin, l.labId),
        }));
        json(res, 200, { labs });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });
}
