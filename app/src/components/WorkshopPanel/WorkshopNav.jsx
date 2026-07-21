import Dropdown from "react-bootstrap/Dropdown";
import { useActiveSection, useWorkshop } from "../../WorkshopContext";
import "./WorkshopNav.scss";

export function WorkshopNav() {
  const { sections } = useWorkshop();
  const { activeSection, changeActiveSection } = useActiveSection();

  const index = sections.findIndex((s) => s.id === activeSection?.id);

  return (
    <Dropdown className="workshop-nav dropdown-center" drop="up-centered">
      <Dropdown.Toggle
        as="button"
        className="workshop-nav-toggle"
        id="labspace-nav-dropdown"
      >
        <span className="workshop-nav-toggle-index">{index + 1}</span>
        <span className="workshop-nav-toggle-title text-truncate">
          {activeSection ? activeSection.title : "Sections"}
        </span>
        <span className="material-symbols-outlined workshop-nav-toggle-caret">
          unfold_more
        </span>
      </Dropdown.Toggle>

      <Dropdown.Menu align="center" className="workshop-nav-menu">
        {sections.map((section, i) => (
          <Dropdown.Item
            key={section.id}
            active={activeSection?.id === section.id}
            onClick={() => changeActiveSection(section.id)}
            className="workshop-nav-item"
          >
            <span className="workshop-nav-item-index">{i + 1}</span>
            <span className="workshop-nav-item-title">{section.title}</span>
            {activeSection?.id === section.id && (
              <span className="material-symbols-outlined workshop-nav-item-check">
                check
              </span>
            )}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
