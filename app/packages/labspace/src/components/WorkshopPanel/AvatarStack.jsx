import "./AvatarStack.scss";

// A reusable overlapping stack of learner avatar bubbles, used by the header
// presence bar (global) and per-milestone presence (in the instructions). Your
// own bubble, when identifiable, is sorted first and ringed. A "+N" chip folds
// in everyone beyond `max` (or beyond the provided `total`).

export function AvatarStack({
  avatars = [],
  total,
  ownId,
  max = 4,
  size = "md",
}) {
  if (!avatars.length) return null;
  const sorted = ownId
    ? [...avatars].sort((a, b) =>
        a.id === ownId ? -1 : b.id === ownId ? 1 : 0,
      )
    : avatars;
  const shown = sorted.slice(0, max);
  const overflow = Math.max(0, (total ?? avatars.length) - shown.length);

  return (
    <div className={`avatar-stack avatar-stack--${size}`} aria-hidden="true">
      {shown.map((a) => (
        <span
          key={a.id}
          className={"avatar-bubble" + (a.id === ownId ? " is-you" : "")}
          style={{ backgroundColor: a.color || "var(--wp-accent)" }}
          title={a.id === ownId ? "You" : a.name || "Someone here"}
        >
          {a.emoji || (a.name ? a.name[0].toUpperCase() : "")}
        </span>
      ))}
      {overflow > 0 && (
        <span className="avatar-bubble avatar-bubble--more">+{overflow}</span>
      )}
    </div>
  );
}
