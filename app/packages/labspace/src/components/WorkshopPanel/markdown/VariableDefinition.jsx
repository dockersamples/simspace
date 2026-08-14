import { useId, useState } from "react";
import { useVariables } from "../../../context/WorkshopContext";

/**
 * This custom markdown directive provides the ability to define a Labspace variable.
 *
 * Usage example:
 * ::variableDefinition[variableName]{prompt="What is your username?"}
 *
 * With this directive, the variableName is provided to this component as `children`.
 *
 * Once defined, variables can be used anywhere in the Markdown using the $$variableName$$ syntax.
 *
 * @returns
 */
export function VariableDefinition({ children, prompt }) {
  const { variables, setVariable } = useVariables();
  const [value, setValue] = useState(variables[children] || "");
  const inputId = useId();

  const hasValue =
    variables[children] !== undefined && variables[children] !== "";
  const valueChanged = value !== (variables[children] || "");

  return (
    <div
      className={"wp-variable-card" + (hasValue ? "" : " is-unset")}
      // Several of these can sit in one section, so the id has to be unique per
      // instance rather than a fixed string.
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setVariable(children, value);
        }}
      >
        <label className="wp-variable-label" htmlFor={inputId}>
          <span className="material-symbols-outlined wp-variable-icon">
            tune
          </span>
          {prompt || `WARNING: NO PROMPT DEFINED FOR ${children}`}
        </label>
        <div className="wp-variable-group">
          <input
            id={inputId}
            className="wp-variable-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="submit"
            className={
              "wp-variable-submit" + (valueChanged ? " is-primary" : "")
            }
            disabled={!valueChanged}
          >
            {hasValue ? "Update" : "Set"}
          </button>
        </div>
      </form>
    </div>
  );
}
