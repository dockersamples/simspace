// Entry point: wire the stores together, start the HTTP server, and sweep
// expired presence sessions on an interval.

import { config } from "./config.js";
import { EventLog } from "./store/sqlite.js";
import { PresenceStore } from "./store/presence.js";
import { createApp } from "./server.js";

const log = new EventLog(config.dbPath);
const presence = new PresenceStore(
  config.presenceTtlMs,
  config.presenceSampleSize,
);

const server = createApp({ config, log, presence });

// Proactively expire stale sessions so counts fall even with no reads.
const sweepTimer = setInterval(
  () => presence.sweep(),
  Math.max(5_000, Math.floor(config.presenceTtlMs / 2)),
);
sweepTimer.unref();

server.listen(config.port, () => {
  console.log(
    `pulse listening on :${config.port} (db=${config.dbPath}, ttl=${config.presenceTtlMs}ms, stats=${config.statsToken ? "on" : "disabled"})`,
  );
});

function shutdown() {
  clearInterval(sweepTimer);
  server.close(() => {
    log.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
