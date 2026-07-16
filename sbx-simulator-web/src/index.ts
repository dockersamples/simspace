// Public entry point for the sbx-simulator-web package.

export { SbxTerminal } from "./react/SbxTerminal";
export type { SbxTerminalProps } from "./react/SbxTerminal";
export { useSimulator } from "./react/useSimulator";
export type { UseSimulatorResult } from "./react/useSimulator";

// The engine is exported too, for embedding or headless use.
export { Simulator } from "./engine/simulator";
export type {
  SimulatorInit,
  CommandOutcome,
  AgentOutcome,
  OutputLine,
} from "./engine/simulator";
export * from "./engine/types";
