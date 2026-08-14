import { useEffect, useState } from "react";

// One button in a code block's header (Copy / Run / Save).
//
// The tooltip is a CSS `::after` on the wrapper rather than a positioned popper
// component: it's one line of markup, needs no layout library, and can't leak a
// floating element into a host page's stacking context.
export function CodeBlockAction({ icon, onClick, completedText, tooltip }) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!completed) return;
    setTimeout(() => setCompleted(false), 2000);
  }, [completed]);

  return (
    <span className="code-action-wrap" data-tooltip={tooltip || undefined}>
      <button
        type="button"
        className="code-action-btn"
        aria-label={tooltip}
        onClick={() => {
          setRunning(true);
          onClick()
            .then(() => setCompleted(true))
            .catch(() => setHasError(true))
            .finally(() => setRunning(false));
        }}
        disabled={running}
      >
        {completed && completedText && <>{completedText}</>}
        {running && <span className="code-action-spinner" aria-hidden="true" />}
        {hasError && <span className="code-action-error">❌ Error</span>}
        {(!completed || (completed && !completedText)) &&
          !running &&
          !hasError && (
            <span className="material-symbols-outlined">{icon}</span>
          )}
      </button>
    </span>
  );
}
