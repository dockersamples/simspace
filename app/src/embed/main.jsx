import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Labspace } from "@dockersamples/simspace-labspace";

// The embed harness (see embed.html for why it exists).
//
// This file is the entire integration a host needs, and that is the claim being
// tested: one import, one component, one URL. Note what is NOT here — no
// Bootstrap, no router, no toast container, no app stylesheet, no font loading,
// no theme wiring. If any of those turn out to be required, they belong in the
// package, not in this file.
//
// It mirrors what Docker Learn's Astro page will do, except that Learn will
// resolve the scenario at BUILD time and pass `config` instead of
// `labspaceUrl`, so the instructions are in the served HTML.

const labspaceUrl = new URL(
  "labs/tour-of-docker/labspace.yaml",
  document.baseURI,
).toString();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Labspace
      labspaceUrl={labspaceUrl}
      // Its own storage namespace, so poking at the harness doesn't overwrite
      // the progress or terminal transcripts of the same lab in the app.
      labKey="embed-harness"
      brand={{ eyebrow: "Lab" }}
      autoSaveId="embed-harness-split"
    />
  </StrictMode>,
);
