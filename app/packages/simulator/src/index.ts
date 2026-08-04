// Package entry point: the simulator engine.
//
// A pure, deterministic state machine — no DOM, no browser APIs, no network, no
// randomness, and no clock. Given the same YAML spec and the same sequence of
// commands it always produces the same output, state, and files, which is what
// makes it safe to embed anywhere (a lab, a docs page, a slide, a test).
//
//   import { Simulator } from "@dockersamples/simspace-simulator";
//   const sim = new Simulator({ spec: yamlText });
//   sim.execute("docker ps");
//
// The React terminal UI lives behind the "./react" subpath so consumers that
// only need the engine (validators, tooling, tests) never pull in React.

export * from "./engine/index";
