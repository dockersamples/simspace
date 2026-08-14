import { useActiveSection, useWorkshop } from "../../context/WorkshopContext";
import { useProgress } from "../../context/ProgressContext";
import { AvatarStack } from "./AvatarStack";
import "./SectionMilestones.scss";

// A compact strip at the top of a section listing its milestones (steps). Each
// shows the learner's own completion check and, when a backend is connected,
// LIVE presence at that milestone — how many others' progress currently sits
// there, with a small avatar cluster. Only live counts are ever shown, framed
// positively (no cumulative/drop-off numbers, no "0 here").
//
// Renders only for sections that declare steps; a lab with no steps sees
// nothing. Works without a backend too — then it's just a mini step checklist.

export function SectionMilestones() {
  const workshop = useWorkshop();
  const { activeSection } = useActiveSection();
  const tracking = useProgress();

  const section = (workshop.sections || []).find(
    (s) => s.id === activeSection?.id,
  );
  const steps = section?.steps || [];
  if (!steps.length) return null;

  const presence = tracking?.presence;
  const perMilestone = presence?.perMilestone || {};
  const allAvatars = presence?.avatars || [];
  const ownId = tracking?.actor?.id;

  return (
    <div className="section-milestones">
      <span className="section-milestones-caption">Milestones</span>
      <ul className="section-milestones-list">
        {steps.map((step) => {
          const done = tracking?.isStepComplete?.(step.id);
          // How many learners' progress currently sits at this milestone.
          const here = perMilestone[step.id] || 0;
          const bubbles = allAvatars.filter((a) => a.milestone === step.id);
          return (
            <li
              key={step.id}
              className={"section-milestone" + (done ? " is-done" : "")}
            >
              <span className="section-milestone-check material-symbols-outlined">
                {done ? "check_circle" : "radio_button_unchecked"}
              </span>
              <span className="section-milestone-title">
                {step.title || step.id}
              </span>
              {here > 0 && (
                <span
                  className="section-milestone-presence"
                  title={`${here} here now`}
                >
                  <AvatarStack
                    avatars={bubbles}
                    total={here}
                    ownId={ownId}
                    max={3}
                    size="sm"
                  />
                  <span className="section-milestone-count">{here} here</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
