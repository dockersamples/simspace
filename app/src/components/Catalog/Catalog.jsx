import { useEffect, useState } from "react";
import { Link } from "react-router";
import "./Catalog.scss";

// Cumulative "N completed this lab" from the pulse backend. This is the ONE
// place a cumulative number is shown — the catalog, not inside a running lab —
// and only when at least one person has finished, so a new lab reads as fresh
// rather than empty.
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
    <span className="catalog-chip catalog-chip-completed">
      <span className="material-symbols-outlined">check_circle</span>
      {count} completed
    </span>
  );
}

// The lab-selection landing page. Lists every lab as a card that links into
// `#/labs/:id`. Home renders it only when the catalog has two or more labs (a
// single lab is entered directly, with no landing page).
export function Catalog({ labs }) {
  useEffect(() => {
    document.title = "Labspace — Choose a lab";
  }, []);

  return (
    <div className="catalog">
      <header className="catalog-header">
        <div className="catalog-brand">
          <img src="docker.svg" alt="" className="catalog-brand-logo" />
          <span className="catalog-eyebrow">Labspace</span>
        </div>
        <h1 className="catalog-title">Choose a lab</h1>
        <p className="catalog-subtitle">
          Pick a hands-on lab below. Everything runs right in your browser — no
          setup required.
        </p>
      </header>

      <ul className="catalog-grid">
        {labs.map((lab) => (
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
                  lab.tracking) && (
                  <span className="catalog-card-meta">
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
                    <LabCompletedCount tracking={lab.tracking} />
                  </span>
                )}
              </span>
              <span className="catalog-card-arrow material-symbols-outlined">
                arrow_forward
              </span>
            </Link>
            {lab.tracking && (
              <Link
                to={`/labs/${lab.id}/insights`}
                className="catalog-card-insights"
              >
                <span className="material-symbols-outlined">bar_chart</span>
                Insights
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
