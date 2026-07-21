import { useActiveSection, useWorkshop } from "../../WorkshopContext";
import { WorkshopNav } from "./WorkshopNav";

// Bottom navigation for the instructions pane: Previous / section picker / Next.
export function WorkshopFooter() {
  const { sections } = useWorkshop();
  const { activeSection, changeActiveSection } = useActiveSection();

  const index = sections.findIndex((s) => s.id === activeSection.id);
  const hasNext = index < sections.length - 1;
  const hasPrev = index > 0;

  return (
    <footer className="workshop-footer">
      <button
        type="button"
        className="workshop-nav-btn workshop-nav-btn--prev"
        onClick={() => hasPrev && changeActiveSection(sections[index - 1].id)}
        disabled={!hasPrev}
      >
        <span className="material-symbols-outlined">arrow_back</span>
        <span>Previous</span>
      </button>

      <WorkshopNav />

      <button
        type="button"
        className="workshop-nav-btn workshop-nav-btn--next"
        onClick={() => hasNext && changeActiveSection(sections[index + 1].id)}
        disabled={!hasNext}
      >
        <span>Next</span>
        <span className="material-symbols-outlined">arrow_forward</span>
      </button>
    </footer>
  );
}
