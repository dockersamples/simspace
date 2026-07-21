import { useActiveSection, useWorkshop } from "../../WorkshopContext";

// Sticky branded header for the instructions pane. Shows the lab identity and a
// segmented progress bar so the learner always knows where they are.
export function WorkshopHeader() {
  const { title, sections } = useWorkshop();
  const { activeSection } = useActiveSection();

  const index = sections.findIndex((s) => s.id === activeSection?.id);
  const current = index < 0 ? 0 : index;

  return (
    <header className="workshop-header">
      <div className="workshop-header-bar">
        <div className="workshop-brand">
          <img src="docker.svg" alt="" className="workshop-brand-logo" />
          <div className="workshop-brand-text">
            <span className="workshop-brand-eyebrow">Labspace</span>
            <span className="workshop-brand-title" title={title}>
              {title}
            </span>
          </div>
        </div>
        <div className="workshop-progress-count">
          <span className="workshop-progress-current">{current + 1}</span>
          <span className="workshop-progress-total">/ {sections.length}</span>
        </div>
      </div>
      <div
        className="workshop-progress-track"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={sections.length}
      >
        {sections.map((section, i) => (
          <span
            key={section.id}
            className={
              "workshop-progress-segment" +
              (i < current ? " is-complete" : "") +
              (i === current ? " is-active" : "")
            }
          />
        ))}
      </div>
    </header>
  );
}
