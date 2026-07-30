import { useTracking } from "../../context/TrackingContext";

// Live "who's here now" for the header — a Google-Docs-style stack of avatar
// bubbles plus a count. Driven entirely by the presence aggregate polled in
// TrackingContext; renders nothing unless the lab opted into presence and at
// least one learner (you) is currently active.
//
// By design this only ever shows LIVE presence, framed positively — never a
// cumulative or drop-off number. Empty/one-person states are fine ("1 here").

const MAX_SHOWN = 4;

export function PresenceBar() {
  const tracking = useTracking();
  if (!tracking?.presenceEnabled) return null;

  const presence = tracking.presence;
  const total = presence?.total || 0;
  if (total < 1) return null;

  const ownId = tracking.actor?.id;
  // Put "you" first so your own bubble is always visible in the stack.
  const avatars = [...(presence.avatars || [])].sort((a, b) =>
    a.id === ownId ? -1 : b.id === ownId ? 1 : 0,
  );
  const shown = avatars.slice(0, MAX_SHOWN);
  const overflow = Math.max(0, total - shown.length);
  const label = `${total} ${total === 1 ? "person" : "people"} here now`;

  return (
    <div className="workshop-presence" title={label} aria-label={label}>
      <div className="workshop-presence-stack" aria-hidden="true">
        {shown.map((a) => (
          <span
            key={a.id}
            className={
              "workshop-presence-avatar" + (a.id === ownId ? " is-you" : "")
            }
            style={{ backgroundColor: a.color || "var(--wp-accent)" }}
            title={a.id === ownId ? "You" : a.name || "Someone here"}
          >
            {a.emoji || (a.name ? a.name[0].toUpperCase() : "")}
          </span>
        ))}
        {overflow > 0 && (
          <span className="workshop-presence-avatar workshop-presence-more">
            +{overflow}
          </span>
        )}
      </div>
      <span className="workshop-presence-label">{total} here</span>
    </div>
  );
}
