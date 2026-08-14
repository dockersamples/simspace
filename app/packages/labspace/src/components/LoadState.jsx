import { useCallback } from "react";
import "./LoadState.scss";

// The runtime's own loading and error surfaces.
//
// Self-contained on purpose: the lab app has a global Bootstrap spinner and a
// toast container, and an embedding site has neither. Both states also have to
// read inside someone else's page, so they fill their container and inherit its
// colours rather than painting a full-viewport screen.

export function LoadingState({ className = "" }) {
  return (
    <div className={`labspace-loadstate ${className}`.trim()} role="status">
      <span className="labspace-loadstate-spinner" aria-hidden="true" />
      <p className="labspace-loadstate-text">Loading lab…</p>
    </div>
  );
}

export function ErrorState({ error, className = "" }) {
  const reload = useCallback(() => window.location.reload(), []);

  return (
    <div className={`labspace-loadstate ${className}`.trim()} role="alert">
      <p className="labspace-loadstate-title">This lab could not be loaded.</p>
      {error?.message && (
        <p className="labspace-loadstate-detail">{error.message}</p>
      )}
      <button
        type="button"
        className="labspace-loadstate-retry"
        onClick={reload}
      >
        Reload the page
      </button>
    </div>
  );
}
