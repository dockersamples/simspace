// Demo playground for SbxTerminal: pick or edit a lab spec on the left, drive
// the in-browser terminal on the right, and watch the live state tree update.

import { useMemo, useState } from "react";
import { SbxTerminal } from "../react/SbxTerminal";
import { SAMPLES } from "./samples";
import "./demo.css";

export default function App() {
  const [sampleIdx, setSampleIdx] = useState(0);
  const [spec, setSpec] = useState(SAMPLES[0].spec);
  const [state, setState] = useState<Record<string, unknown>>({});

  const files = useMemo(() => SAMPLES[sampleIdx].files, [sampleIdx]);

  const pickSample = (idx: number) => {
    setSampleIdx(idx);
    setSpec(SAMPLES[idx].spec);
  };

  return (
    <div className="demo">
      <header className="demo-header">
        <h1>SBX Simulator — Web Terminal</h1>
        <p>
          A React component that runs an SBX Simulator lab from its spec YAML,
          entirely in the browser. Only <code>sbx</code> commands and agent
          prompts are simulated.
        </p>
        <div className="demo-samples">
          {SAMPLES.map((s, i) => (
            <button
              key={s.name}
              className={i === sampleIdx ? "active" : ""}
              onClick={() => pickSample(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </header>

      <div className="demo-grid">
        <section className="demo-pane">
          <h2>sbx-simulator.yaml</h2>
          <textarea
            className="demo-editor"
            value={spec}
            spellCheck={false}
            onChange={(e) => setSpec(e.target.value)}
          />
        </section>

        <section className="demo-pane demo-term-pane">
          <h2>Terminal</h2>
          <SbxTerminal
            spec={spec}
            files={files}
            onStateChange={setState}
            className="demo-term"
          />
        </section>

        <section className="demo-pane demo-state-pane">
          <h2>Live state</h2>
          <pre className="demo-state">{JSON.stringify(state, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
