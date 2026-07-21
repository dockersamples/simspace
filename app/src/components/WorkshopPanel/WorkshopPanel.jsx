import { useActiveSection } from "../../WorkshopContext";
import { MarkdownRenderer } from "./markdown/MarkdownRenderer";
import { WorkshopHeader } from "./WorkshopHeader";
import { WorkshopFooter } from "./WorkshopFooter";
import "./WorkshopPanel.scss";

export function WorkshopPanel() {
  const { activeSection } = useActiveSection();

  return (
    <div className="workshop-panel d-flex flex-column h-100">
      <WorkshopHeader />

      <div className="workshop-scroll flex-grow-1 overflow-auto">
        <div className="workshop-body">
          <MarkdownRenderer key={`section-${activeSection.id}`}>
            {activeSection.content}
          </MarkdownRenderer>
        </div>
      </div>

      <WorkshopFooter />
    </div>
  );
}
