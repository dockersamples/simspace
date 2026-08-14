// The `pulse` analytics adapter — this app's implementation of the seam the
// runtime exposes.
//
// The runtime records milestones and calls `track(event, payload)`; everything
// about WHERE those go lives here: pulse's wire format, the fire-and-forget
// transport, and the live-presence stream. That split is what lets the same
// runtime run silently inside a host that has its own analytics (or none),
// without pulse's endpoint, heartbeat, or SSE connection coming along for the
// ride.
//
// Build one with the RESOLVED tracking config (the deployment default from
// config.json merged with the lab's own directive; see labspace/tracking.js in
// the package). A null/endpoint-less config means tracking is off — return no
// adapter at all and the runtime falls back to its no-op.

const HEARTBEAT_MS = 15_000;
const PRESENCE_POLL_MS = 10_000;

export function createPulseAnalytics(resolved) {
  if (!resolved?.endpoint) return null;

  const endpoint = resolved.endpoint;
  const allowName = resolved.identity !== "anonymous";
  const presenceEnabled = resolved.presence !== false;
  const labId = resolved.labId;

  return {
    labId,
    // Asking for a heartbeat is what makes the runtime start a timer; an
    // adapter that doesn't want presence simply omits this.
    heartbeatMs: presenceEnabled ? HEARTBEAT_MS : 0,

    track(event, payload) {
      const { labVersion, sessionId, actor, avatar, ...rest } = payload;
      const body = JSON.stringify({
        labId,
        labVersion,
        sessionId,
        actor: actor
          ? { id: actor.id, name: allowName ? actor.name : undefined }
          : undefined,
        avatar,
        event,
        ts: new Date().toISOString(),
        ...rest,
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

    // Live presence for the UI: prefer the SSE stream (smoother), fall back to
    // polling if the browser or server can't do SSE.
    subscribePresence: presenceEnabled
      ? (onPresence) => {
          let cancelled = false;
          let es = null;
          let timer = null;
          const q = `labId=${encodeURIComponent(labId)}`;

          const poll = async () => {
            try {
              const res = await fetch(`${endpoint}/presence?${q}`);
              if (!res.ok) return;
              const data = await res.json();
              if (!cancelled) onPresence(data);
            } catch {
              /* presence is best-effort */
            }
          };
          const startPolling = () => {
            if (timer || cancelled) return;
            poll();
            timer = setInterval(poll, PRESENCE_POLL_MS);
          };

          if (typeof EventSource !== "undefined") {
            try {
              es = new EventSource(`${endpoint}/stream?${q}`);
              es.onmessage = (e) => {
                if (cancelled) return;
                try {
                  onPresence(JSON.parse(e.data));
                } catch {
                  /* ignore malformed frame */
                }
              };
              es.onerror = () => {
                // Only give up on SSE when the connection is truly closed (e.g.
                // the server doesn't support it); transient drops auto-reconnect.
                if (es && es.readyState === EventSource.CLOSED) {
                  es = null;
                  startPolling();
                }
              };
            } catch {
              startPolling();
            }
          } else {
            startPolling();
          }

          return () => {
            cancelled = true;
            if (es) es.close();
            if (timer) clearInterval(timer);
          };
        }
      : undefined,
  };
}
