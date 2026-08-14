import { useProgress } from "../../context/ProgressContext.jsx";
import { AvatarStack } from "./AvatarStack.jsx";

// Live "who's here now" for the header — a Google-Docs-style stack of avatar
// bubbles plus a count. Driven entirely by the presence aggregate polled in
// the progress layer; renders nothing unless the lab opted into presence and at
// least one learner (you) is currently active.
//
// By design this only ever shows LIVE presence, framed positively — never a
// cumulative or drop-off number. Empty/one-person states are fine ("1 here").

export function PresenceBar() {
  const tracking = useProgress();
  if (!tracking?.presenceEnabled) return null;

  const presence = tracking.presence;
  const total = presence?.total || 0;
  if (total < 1) return null;

  const label = `${total} ${total === 1 ? "person" : "people"} here now`;

  return (
    <div className="workshop-presence" title={label} aria-label={label}>
      <AvatarStack
        avatars={presence.avatars || []}
        total={total}
        ownId={tracking.actor?.id}
        size="md"
      />
      <span className="workshop-presence-label">{total} here</span>
    </div>
  );
}
