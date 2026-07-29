import { useEffect } from "react";
import { Link } from "react-router";
import "./Catalog.scss";

// Landing page shown when a labs.json catalog is deployed. Lists every
// available lab as a card that links into `#/labs/:id`. Rendered by Home only
// in catalog mode, so it never appears in the single-lab fallback.
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
                {(lab.tags.length > 0 || lab.estimatedMinutes != null) && (
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
                  </span>
                )}
              </span>
              <span className="catalog-card-arrow material-symbols-outlined">
                arrow_forward
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
