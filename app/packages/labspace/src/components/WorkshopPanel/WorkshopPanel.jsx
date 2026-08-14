import { useActiveSection } from "../../context/WorkshopContext";
import { MarkdownRenderer } from "./markdown/MarkdownRenderer";
import { WorkshopHeader } from "./WorkshopHeader";
import { WorkshopFooter } from "./WorkshopFooter";
import { SectionMilestones } from "./SectionMilestones";
import "./WorkshopPanel.scss";

// The instructions pane: header, the rendered section, and the footer nav.
//
// `brand` and `menuItems` are the host's, and are passed straight through to the
// header (see WorkshopHeader for their shape). `components` registers extra
// markdown directives — the same seam the deck uses. `theme` is "light",
// "dark", or "auto" (the default: follow the reader's system preference).
export function WorkshopPanel({
  brand,
  menuItems,
  components,
  theme = "auto",
}) {
  const { activeSection } = useActiveSection();

  return (
    <div
      className="workshop-panel"
      data-labspace-theme={theme === "auto" ? undefined : theme}
    >
      <WorkshopHeader brand={brand} menuItems={menuItems} />

      <div className="workshop-scroll">
        <div className="workshop-body">
          <SectionMilestones />
          <MarkdownRenderer
            key={`section-${activeSection.id}`}
            baseUrl={activeSection.baseUrl}
            components={components}
          >
            {activeSection.content}
          </MarkdownRenderer>
        </div>
      </div>

      <WorkshopFooter />
    </div>
  );
}
