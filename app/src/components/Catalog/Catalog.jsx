import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  progress,
  resolveTracking,
} from "@dockersamples/simspace-labspace/loader";
import { useAppConfig } from "../../context/AppConfigContext";
import "./Catalog.scss";

// Social-proof "Completed by N people" from the pulse backend — how many OTHERS
// have finished this lab. This is the ONE place a cumulative number is shown
// (the catalog, not inside a running lab), and only when at least one person has
// finished, so a new lab reads as fresh rather than empty. Deliberately styled
// as a neutral stat with a people icon — not a green personal "you completed
// this" check.
function LabCompletedCount({ tracking }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!tracking?.endpoint || !tracking?.labId) return undefined;
    let cancelled = false;
    const url = `${tracking.endpoint.replace(/\/+$/, "")}/completed?labId=${encodeURIComponent(
      tracking.labId,
    )}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.completed === "number")
          setCount(d.completed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tracking]);

  if (!count || count < 1) return null;
  return (
    <span className="catalog-card-completed">
      <span className="material-symbols-outlined">group</span>
      Completed by {count} {count === 1 ? "person" : "people"}
    </span>
  );
}

// The lab-selection landing page. Lists every lab as a card that links into
// `#/labs/:id`. Home renders it only when the catalog has two or more labs (a
// single lab is entered directly, with no landing page).
export function Catalog({ labs }) {
  const appConfig = useAppConfig();

  // The catalog can hold labs, slide decks, or both, so the copy adapts rather
  // than calling a deck a lab. "Choose a lab" stays the wording for a lab-only
  // deployment, which is the common case and the one people have bookmarked.
  const hasDecks = labs.some((lab) => lab.kind === "slides");
  const hasLabs = labs.some((lab) => lab.kind !== "slides");
  const heading =
    hasDecks && hasLabs
      ? "Start here"
      : hasDecks
        ? "Choose a deck"
        : "Choose a lab";
  const subtitle =
    hasDecks && hasLabs
      ? "Slides and hands-on labs. Everything runs right in your browser — no setup required."
      : hasDecks
        ? "Pick a deck below. Everything runs right in your browser — no setup required."
        : "Pick a hands-on lab below. Everything runs right in your browser — no setup required.";

  useEffect(() => {
    document.title = `Labspace — ${heading}`;
  }, [heading]);

  return (
    <div className="catalog">
      <header className="catalog-header">
        <div className="catalog-brand">
          <img src="docker.svg" alt="" className="catalog-brand-logo" />
          <span className="catalog-eyebrow">Labspace</span>
        </div>
        <h1 className="catalog-title">{heading}</h1>
        <p className="catalog-subtitle">{subtitle}</p>
      </header>

      <ul className="catalog-grid">
        {labs.map((lab) => {
          // Personal completion: has THIS browser finished all the lab's steps?
          // Read from the local progress store — no backend needed.
          const done = progress.isLabComplete(lab.id);
          // Effective backend config (deployment default + this lab's directive)
          // for the social "Completed by N people" count.
          const tracking = resolveTracking(
            appConfig?.tracking,
            lab.tracking,
            lab.id,
          );
          return (
            <li key={lab.id}>
              <Link to={`/labs/${lab.id}`} className="catalog-card">
                <span className="catalog-card-icon material-symbols-outlined">
                  {lab.icon}
                </span>
                <span className="catalog-card-body">
                  <span className="catalog-card-title">{lab.title}</span>
                  {lab.description && (
                    <span className="catalog-card-desc">{lab.description}</span>
                  )}
                  {(lab.tags.length > 0 ||
                    lab.estimatedMinutes != null ||
                    done) && (
                    <span className="catalog-card-meta">
                      {done && (
                        <span className="catalog-chip catalog-chip-done">
                          <span className="material-symbols-outlined">
                            check_circle
                          </span>
                          Completed
                        </span>
                      )}
                      {lab.estimatedMinutes != null && (
                        <span className="catalog-chip catalog-chip-time">
                          <span className="material-symbols-outlined">
                            schedule
                          </span>
                          ~{lab.estimatedMinutes} min
                        </span>
                      )}
                      {lab.tags.map((tag) => (
                        <span key={tag} className="catalog-chip">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                  <LabCompletedCount tracking={tracking} />
                </span>
                <span className="catalog-card-arrow material-symbols-outlined">
                  arrow_forward
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
