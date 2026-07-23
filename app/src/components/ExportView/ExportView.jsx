import { useEffect } from "react";
import { MarkdownRenderer } from "../WorkshopPanel/markdown/MarkdownRenderer";
import { useWorkshop, useVariables } from "../../WorkshopContext";
import { substituteVariables } from "../../labspace/slugify";
import "./ExportView.scss";

// Print/export view: renders every section top-to-bottom from the already
// loaded workshop, with variables substituted.
export function ExportView() {
  const workshop = useWorkshop();
  const { variables } = useVariables();

  useEffect(() => {
    if (workshop) document.title = `${workshop.title} — Print View`;
  }, [workshop]);

  return (
    <div className="export-view p-5">
      <header className="export-header mb-4">
        <h1>{workshop.title}</h1>
        {workshop.subtitle && <p className="lead">{workshop.subtitle}</p>}
      </header>
      {workshop.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="export-section mb-5"
        >
          <MarkdownRenderer baseUrl={section.baseUrl}>
            {substituteVariables(section.contentRaw, variables)}
          </MarkdownRenderer>
        </section>
      ))}
    </div>
  );
}
